"""Request-based yt-dlp downloads. Files exist only for the current request."""
import hashlib
import hmac
import json
import logging
import mimetypes
import os
import queue
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
# The downloader is private: every download needs the password with this SHA-256 hash.
# set_password.py saves it in downloader-password.env, which Docker Compose passes in.
PASSWORD_SHA256 = os.environ.get('DOWNLOADER_PASSWORD_SHA256', '').strip().lower()
STORAGE_DIR = Path(tempfile.gettempdir()) / 'av-downloader'
MIN_FREE_BYTES = 1024**3
# Keep in sync with client_max_body_size in docker/prod/locations.conf.
MAX_REQUEST_BYTES = 8 * 1024
DOWNLOAD_LINK_SECONDS = 10 * 60
METADATA_TIMEOUT_SECONDS = 120
PROGRESS_PREFIX = 'av-progress:'
ALLOWED_DOMAINS = ('youtube.com', 'youtu.be', 'vimeo.com', 'tiktok.com')
# Optional YouTube cookies: cookies.txt in the project root, or where the Compose files mount it.
COOKIES_FILE = Path(os.environ.get('COOKIES_FILE') or Path(__file__).resolve().parent.parent / 'cookies.txt')
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


def check_password(password):
    if not PASSWORD_SHA256:
        return False
    hashed = hashlib.sha256(password.encode()).hexdigest()
    return hmac.compare_digest(hashed, PASSWORD_SHA256)


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


def check_free_space():
    if shutil.disk_usage(STORAGE_DIR).free < MIN_FREE_BYTES:
        raise DownloadError('Downloader disk space is low. Please try again later.')


def run_download(args, on_output):
    """Run yt-dlp, passing each output line to on_output.

    While yt-dlp is silent, check free space and send a heartbeat each second, so a
    disconnected client is noticed. yt-dlp and its FFmpeg children are always stopped.
    """
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               text=True, encoding='utf-8', errors='replace', start_new_session=True)
    lines = queue.Queue()

    def read():
        for line in process.stdout:
            lines.put(line)
        lines.put(None)

    reader = threading.Thread(target=read)
    reader.start()
    try:
        while True:
            check_free_space()
            try:
                line = lines.get(timeout=1)
            except queue.Empty:
                on_output({'type': 'heartbeat'})
                continue
            if line is None:
                break
            on_output(line.rstrip())
        if process.wait():
            raise DownloadError('yt-dlp could not complete the download. See its output above for details.')
    finally:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
        reader.join()
        process.stdout.close()


def progress_event(line):
    """Turn a yt-dlp progress line (see --progress-template) into an event, or None for other lines."""
    if not line.startswith(PROGRESS_PREFIX):
        return None
    try:
        progress = json.loads(line[len(PROGRESS_PREFIX):])
    except ValueError:
        return None
    if not isinstance(progress, dict):
        return None
    return {
        'type': 'progress',
        'stage': 'postprocess' if progress.get('postprocessor') else 'download',
        **{key: progress.get(key) for key in (
            'status', 'downloaded_bytes', 'total_bytes', 'total_bytes_estimate', 'speed', 'eta')},
    }


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


def read_metadata(args, on_output):
    try:
        result = subprocess.run(args, capture_output=True, text=True, encoding='utf-8', errors='replace',
                                timeout=METADATA_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        raise DownloadError('Video information lookup timed out.') from None
    for line in result.stderr.splitlines():
        on_output(line)
    if result.returncode:
        raise DownloadError('yt-dlp could not read the video information. See its output above for details.')
    return result.stdout


def download_video(url, download_type, directory, on_output):
    """Download one video into directory and return its final, postprocessed path.

    Output is streamed through on_output rather than stored in memory.
    Media downloads have no overall timeout; live recordings end with the source.
    """
    check_free_space()
    args = YTDLP_ARGS.copy()
    if COOKIES_FILE.is_file():
        # yt-dlp may update cookies. Keep the source read-only and isolate writers.
        cookies = directory / 'cookies.txt'
        shutil.copyfile(COOKIES_FILE, cookies)
        args += ['--cookies', str(cookies)]

    on_output({'type': 'stage', 'stage': 'metadata'})
    metadata = read_metadata(
        args + ['--dump-single-json', '--flat-playlist', '--playlist-items', '1', '--', url],
        on_output)
    info = json.loads(metadata)
    if not isinstance(info, dict):
        raise DownloadError('The source returned invalid video information.')
    # --no-playlist alone still permits playlist-only URLs. Watch links with a
    # playlist parameter are fine, provided yt-dlp resolves an individual video.
    if info.get('_type') in ('playlist', 'multi_video') or 'entries' in info:
        raise DownloadError('Playlists are not supported. Paste a video URL.')

    check_free_space()
    manifest = directory / 'result.txt'
    on_output({'type': 'stage', 'stage': 'download'})
    run_download(
        args + DOWNLOAD_TYPES[download_type] + [
            '--newline', '--progress', '--progress-delta', '1', '--no-colors',
            '--progress-template', 'download:' + PROGRESS_PREFIX + '%(progress)j',
            '--progress-template', 'postprocess:' + PROGRESS_PREFIX + '%(progress)j',
            '-P', str(directory),
            '--print-to-file', 'after_move:filepath', str(manifest), '--', url],
        on_output)
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

    def send_event(self, event):
        """Send one line of the streamed response that DownloadPage.tsx reads."""
        self.wfile.write((json.dumps(event, allow_nan=False) + '\n').encode())
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
        except ConnectionError:
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
            password = fields.get('password', [''])[0]
            url = validate_url(fields.get('url', [''])[0].strip())
            download_type = fields.get('format', ['default'])[0]
            if download_type not in DOWNLOAD_TYPES:
                raise ValueError('Choose a supported download type.')
        except (ValueError, UnicodeError) as exc:
            self.error(400, str(exc))
            return
        if not PASSWORD_SHA256:
            self.error(503, 'No downloader password is set. Run set_password.py on the server.')
            return
        if not check_password(password):
            self.error(401, 'Incorrect password.')
            return
        self.download(url, download_type)

    def download(self, url, download_type):
        """Stream yt-dlp's progress to the browser, ending with a link to the file."""
        try:
            check_free_space()
        except DownloadError as exc:
            self.error(507, str(exc))
            return
        temporary = tempfile.TemporaryDirectory(prefix='av-download-', dir=STORAGE_DIR)
        self.send_response(200)
        self.send_header('Content-Type', 'application/x-ndjson')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Accel-Buffering', 'no')  # Tell Nginx to pass each line on immediately.
        self.end_headers()

        def on_output(output):
            """Send an event dict as is, and a line of yt-dlp output as progress or a log message."""
            if isinstance(output, str):
                event = progress_event(output)
                if event is None:
                    LOGGER.info('%s', output)
                    event = {'type': 'log', 'message': output}
                output = event
            self.send_event(output)

        try:
            output = download_video(url, download_type, Path(temporary.name), on_output)
            # From here on, DOWNLOAD_FILES deletes the files once they're downloaded or the link expires.
            token = DOWNLOAD_FILES.add(temporary, output)
            temporary = None
            self.send_event({'type': 'ready', 'url': f'/api/download/{token}', 'filename': output.name})
        except ConnectionError:
            LOGGER.info('Client disconnected from a download.')
        except Exception as exc:
            LOGGER.exception('Download request failed')
            message = str(exc) if isinstance(exc, DownloadError) else 'Unable to download this video. Check the output for details.'
            try:
                self.send_event({'type': 'error', 'message': message})
            except ConnectionError:
                pass
        finally:
            if temporary:
                temporary.cleanup()

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    if not PASSWORD_SHA256:
        LOGGER.warning('DOWNLOADER_PASSWORD_SHA256 is not set, so every download will be refused.')
    ThreadingHTTPServer((os.environ.get('HOST', '127.0.0.1'), 8000), DownloadHandler).serve_forever()
