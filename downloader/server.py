"""Request-based yt-dlp downloads. Files exist only for the current request."""
import json
import logging
import mimetypes
import os
from pathlib import Path
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlsplit

LOGGER = logging.getLogger(__name__)
DOWNLOAD_SLOTS = threading.BoundedSemaphore(2)
# Keep in sync with client_max_body_size in docker/prod/nginx.conf.
MAX_REQUEST_BYTES = 8 * 1024
DOWNLOAD_LINK_SECONDS = 10 * 60
ALLOWED_DOMAINS = ('youtube.com', 'youtu.be', 'vimeo.com', 'tiktok.com')
YTDLP_ARGS = [
    sys.executable, '-m', 'yt_dlp', '--ignore-config', '--js-runtimes', 'node',
    '--no-playlist', '--no-cache-dir', '--socket-timeout', '20',
    '--retries', '2',
]
DOWNLOAD_TYPES = {
    'default': ['-f', 'bv*+ba/b'],
    'best_audio': ['-f', 'ba/b', '--extract-audio', '--audio-format', 'best'],
    'mp4': ['-f', "bv[ext=mp4]+ba[ext~='^(m4a|aac)$']", '--merge-output-format', 'mp4'],
    'mp3': ['-f', 'ba/b', '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0'],
}


class DownloadError(Exception):
    """A download failure with a message safe to display to the user."""


class DownloadFiles:
    """Short-lived file handoff, not a job queue. Each link can be claimed once."""

    def __init__(self):
        self.files = {}
        self.lock = threading.Lock()

    def add(self, temporary, output):
        token = secrets.token_urlsafe(32)
        timer = threading.Timer(DOWNLOAD_LINK_SECONDS, self.discard, args=(token,))
        timer.daemon = True
        with self.lock:
            self.files[token] = (temporary, output, timer)
        timer.start()
        return token

    def take(self, token):
        with self.lock:
            entry = self.files.pop(token, None)
        if entry:
            temporary, output, timer = entry
            timer.cancel()
            return temporary, output
        return None

    def discard(self, token):
        entry = self.take(token)
        if entry:
            entry[0].cleanup()


DOWNLOAD_FILES = DownloadFiles()


def stop_process(process):
    """Stop yt-dlp and its FFmpeg children if streaming to the client fails."""
    if process.poll() is not None:
        return
    if os.name == 'nt':
        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    process.wait()


def validate_url(value):
    if not isinstance(value, str) or not value or len(value) > 2048:
        raise ValueError('Enter a valid video URL.')
    try:
        url = urlsplit(value)
        host = (url.hostname or '').lower()
        if (url.scheme != 'https' or url.username or url.password
                or url.port not in (None, 443)
                or not any(host == d or host.endswith('.' + d) for d in ALLOWED_DOMAINS)):
            raise ValueError()
    except ValueError:
        raise ValueError('Use an HTTPS YouTube, Vimeo, or TikTok video URL.') from None
    return value


def download_video(url, download_type, directory, on_output):
    """Download one video into directory and return its final, postprocessed path.

    Output is streamed through on_output rather than stored in memory.
    Media downloads have no overall timeout; live recordings end with the source.
    """
    on_output('Checking video information…')
    try:
        metadata = subprocess.run(
            YTDLP_ARGS + ['--dump-single-json', '--flat-playlist', '--playlist-items', '1', '--', url],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=120)
    except subprocess.CalledProcessError as exc:
        for line in (exc.stderr or b'').decode('utf-8', errors='replace').splitlines():
            on_output(line)
        raise
    for line in metadata.stderr.decode('utf-8', errors='replace').splitlines():
        on_output(line)
    info = json.loads(metadata.stdout)
    if not isinstance(info, dict):
        raise DownloadError('The source returned invalid video information.')
    # --no-playlist alone still permits playlist-only URLs. Watch links with a
    # playlist parameter are fine, provided yt-dlp resolves an individual video.
    if info.get('_type') in ('playlist', 'multi_video') or 'entries' in info:
        raise DownloadError('Playlists are not supported. Paste a video URL.')

    manifest = directory / 'result.txt'
    process = subprocess.Popen(
        YTDLP_ARGS + DOWNLOAD_TYPES[download_type] + [
            '--newline', '--progress', '--progress-delta', '1', '--no-colors',
            '-P', str(directory),
            '--print-to-file', 'after_move:filepath', str(manifest), '--', url],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        encoding='utf-8', errors='replace', bufsize=1, start_new_session=os.name != 'nt')
    try:
        while line := process.stdout.readline(16384):
            on_output(line.rstrip())
        if process.wait():
            raise DownloadError('yt-dlp could not complete the download. See its output above for details.')
    finally:
        stop_process(process)
        process.stdout.close()
    if not manifest.is_file():
        raise DownloadError('The download did not produce an output file.')
    output = Path(manifest.read_text(encoding='utf-8').strip()).resolve()
    if output.parent != directory.resolve() or not output.is_file():
        raise DownloadError('The download did not produce a valid output file.')
    return output


class DownloadHandler(BaseHTTPRequestHandler):
    def error(self, status, message):
        body = json.dumps({'error': message}).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def event(self, event_type, **data):
        self.wfile.write((json.dumps({'type': event_type, **data}) + '\n').encode())
        self.wfile.flush()

    def do_GET(self):
        prefix = '/api/download/'
        path = urlsplit(self.path).path
        entry = DOWNLOAD_FILES.take(path[len(prefix):]) if path.startswith(prefix) else None
        if not entry:
            self.error(404, 'Download link expired or already used. Please download the video again.')
            return
        temporary, output = entry
        response_started = False
        try:
            with output.open('rb') as video:
                response_started = True
                self.send_response(200)
                self.send_header('Content-Type', mimetypes.guess_type(output.name)[0] or 'application/octet-stream')
                # RFC 5987 preserves Unicode titles and keeps unsafe characters out of headers.
                self.send_header('Content-Disposition',
                                 f'attachment; filename="download"; filename*=UTF-8\'\'{quote(output.name, safe="")}')
                self.send_header('Content-Length', str(output.stat().st_size))
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                shutil.copyfileobj(video, self.wfile, length=64 * 1024)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            LOGGER.info('Client disconnected during file transfer.')
        except OSError:
            LOGGER.exception('File transfer failed')
            if not response_started:
                self.error(500, 'Unable to send the file. Please download the video again.')
        finally:
            temporary.cleanup()

    def do_POST(self):
        if self.path != '/api/download':
            self.error(404, 'Not found.')
            return
        if self.headers.get_content_type() != 'application/x-www-form-urlencoded':
            self.error(415, 'Submit the form on the download page.')
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_REQUEST_BYTES:
                raise ValueError('Request body is too large or missing.')
            fields = parse_qs(self.rfile.read(length).decode('utf-8'), max_num_fields=4)
            url = validate_url(fields.get('url', [''])[0].strip())
        except (ValueError, UnicodeError) as exc:
            self.error(400, str(exc))
            return
        if not DOWNLOAD_SLOTS.acquire(blocking=False):
            self.error(429, 'The downloader is busy. Please try again shortly.')
            return

        temporary = None
        token = None
        response_started = False
        try:
            temporary = tempfile.TemporaryDirectory(prefix='av-download-')
            response_started = True
            self.send_response(200)
            self.send_header('Content-Type', 'application/x-ndjson')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Accel-Buffering', 'no')
            self.end_headers()

            def on_output(line):
                LOGGER.info('%s', line)
                self.event('log', message=line)

            download_type = fields.get('format', ['default'])[0]
            output = download_video(url, download_type, Path(temporary.name), on_output)
            token = DOWNLOAD_FILES.add(temporary, output)
            self.event('ready', url=f'/api/download/{token}', filename=output.name)
        except (BrokenPipeError, ConnectionResetError):
            LOGGER.info('Client disconnected from a download.')
            if token:
                DOWNLOAD_FILES.discard(token)
        except Exception as exc:
            LOGGER.exception('Download request failed')
            if token:
                DOWNLOAD_FILES.discard(token)
            message = str(exc) if isinstance(exc, DownloadError) else 'Unable to download this video. Check the output for details.'
            try:
                if response_started:
                    self.event('error', message=message)
                else:
                    self.error(500, message)
            except (BrokenPipeError, ConnectionResetError):
                pass
        finally:
            if temporary and not token:
                temporary.cleanup()
            DOWNLOAD_SLOTS.release()


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    ThreadingHTTPServer((os.environ.get('HOST', '127.0.0.1'), 8000), DownloadHandler).serve_forever()
