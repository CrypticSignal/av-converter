"""Request-based yt-dlp downloads. Files exist only for the current request."""
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
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlsplit

LOGGER = logging.getLogger(__name__)
DOWNLOAD_SLOTS = threading.BoundedSemaphore(2)
# Keep in sync with client_max_body_size in docker/prod/nginx.conf.
MAX_REQUEST_BYTES = 8 * 1024
DOWNLOAD_LINK_SECONDS = 10 * 60
HEARTBEAT_SECONDS = 5
METADATA_TIMEOUT_SECONDS = 120
PROGRESS_PREFIX = 'av-progress:'
ALLOWED_DOMAINS = ('youtube.com', 'youtu.be', 'vimeo.com', 'tiktok.com')
COOKIES_FILE = Path(__file__).with_name('cookies.txt')
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


class StorageGuard:
    """Account for every file in the dedicated root, including retained links."""

    def __init__(self):
        self.root = Path(os.environ.get('DOWNLOAD_STORAGE_DIR',
                         str(Path(tempfile.gettempdir()) / 'av-downloader')))
        self.quota = int(os.environ.get('DOWNLOAD_STORAGE_QUOTA_BYTES', 10 * 1024**3))
        self.min_free = int(os.environ.get('DOWNLOAD_MIN_FREE_BYTES', 1024**3))
        self.interval = float(os.environ.get('DOWNLOAD_STORAGE_CHECK_SECONDS', '1'))
        if self.quota <= 0 or self.min_free < 0 or not 0 < self.interval <= 60:
            raise ValueError('Invalid downloader storage limits.')

    def check(self):
        self.root.mkdir(parents=True, exist_ok=True)
        used = 0
        for path in self.root.rglob('*'):
            try:
                if path.is_file():
                    used += path.stat().st_size
            except FileNotFoundError:
                pass  # Another request may have just cleaned up its files.
        if used >= self.quota:
            raise DownloadError('Downloader storage quota reached. Please try again later.')
        if shutil.disk_usage(self.root).free < self.min_free:
            raise DownloadError('Downloader disk space is low. Please try again later.')


STORAGE = StorageGuard()


def stop_process(process):
    """Stop yt-dlp and its FFmpeg children if streaming to the client fails."""
    if os.name == 'nt':
        if process.poll() is not None:
            return
        try:
            subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
        finally:
            if process.poll() is None:
                process.kill()
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    process.wait()


def run_monitored(args, on_output, metadata=False):
    """Drain both pipes while checking storage and the client even for silent jobs."""
    options = {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == 'nt' else {'start_new_session': True}
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, encoding='utf-8', errors='replace', bufsize=1,
                               **options)
    messages = queue.Queue(maxsize=128)
    finished = threading.Event()
    readers = []
    captured = []

    def send(message):
        """Queue a message, giving up once the main loop has finished."""
        while not finished.is_set():
            try:
                messages.put(message, timeout=0.1)
                return
            except queue.Full:
                pass

    def read(pipe, source):
        # Sends (source, line) per line, (None, exception) on a read error,
        # and (source, None) when the pipe closes.
        try:
            while not finished.is_set():
                line = pipe.readline(16384)
                if not line:
                    break
                send((source, line))
        except Exception as exc:
            send((None, exc))
        finally:
            send((source, None))

    started = time.monotonic()
    heartbeat = started + HEARTBEAT_SECONDS
    storage_check = started + STORAGE.interval
    try:
        for source, pipe in (('stdout', process.stdout), ('stderr', process.stderr)):
            thread = threading.Thread(target=read, args=(pipe, source), name='download-pipe')
            thread.start()
            readers.append(thread)
        closed = 0
        while closed < 2 or process.poll() is None:
            now = time.monotonic()
            if metadata and now - started >= METADATA_TIMEOUT_SECONDS:
                raise DownloadError('Video information lookup timed out.')
            if now >= storage_check:
                STORAGE.check()
                storage_check = now + STORAGE.interval
            if now >= heartbeat:
                on_output({'type': 'heartbeat'})
                heartbeat = now + HEARTBEAT_SECONDS
            try:
                source, line = messages.get(timeout=0.05)
            except queue.Empty:
                continue
            if source is None:
                raise line
            if line is None:
                closed += 1
            elif metadata and source == 'stdout':
                captured.append(line)
            else:
                on_output(line.rstrip())
        if process.wait():
            raise DownloadError('yt-dlp could not complete the download. See its output above for details.')
        return ''.join(captured)
    finally:
        finished.set()
        try:
            stop_process(process)
        finally:
            for thread in readers:
                thread.join()
            process.stdout.close()
            process.stderr.close()


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
    return run_monitored(args, on_output, metadata=True)


def download_video(url, download_type, directory, on_output):
    """Download one video into directory and return its final, postprocessed path.

    Output is streamed through on_output rather than stored in memory.
    Media downloads have no overall timeout; live recordings end with the source.
    """
    STORAGE.check()
    args = YTDLP_ARGS.copy()
    if COOKIES_FILE.is_file():
        # yt-dlp may update cookies. Keep the source read-only and isolate writers.
        cookies = directory / 'cookies.txt'
        shutil.copyfile(COOKIES_FILE, cookies)
        args += ['--cookies', str(cookies)]

    on_output({'type': 'stage', 'stage': 'metadata', 'message': 'Checking video information…'})
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

    STORAGE.check()
    manifest = directory / 'result.txt'
    on_output({'type': 'stage', 'stage': 'download', 'message': 'Downloading media…'})
    run_monitored(
        args + DOWNLOAD_TYPES[download_type] + [
            '--newline', '--progress', '--progress-delta', '1', '--no-colors',
            '--progress-template', 'download:' + PROGRESS_PREFIX + '%(progress)j',
            '--progress-template', 'postprocess:' + PROGRESS_PREFIX + '%(progress)j',
            '-P', str(directory),
            '--print-to-file', 'after_move:filepath', str(manifest), '--', url],
        on_output)
    STORAGE.check()
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
        with self.event_lock:
            self.wfile.write((json.dumps({'type': event_type, **data}, allow_nan=False) + '\n').encode())
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
            url = validate_url(fields.get('url', [''])[0].strip())
            download_type = fields.get('format', ['default'])[0]
            if download_type not in DOWNLOAD_TYPES:
                raise ValueError('Choose a supported download type.')
        except (ValueError, UnicodeError) as exc:
            self.error(400, str(exc))
            return
        if not DOWNLOAD_SLOTS.acquire(blocking=False):
            self.error(429, 'The downloader is busy. Please try again shortly.')
            return

        temporary = None
        self.event_lock = threading.Lock()
        token = None
        response_started = False
        try:
            STORAGE.check()
            temporary = tempfile.TemporaryDirectory(prefix='av-download-', dir=STORAGE.root)
            response_started = True
            self.send_response(200)
            self.send_header('Content-Type', 'application/x-ndjson')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Accel-Buffering', 'no')
            self.end_headers()

            def on_output(line):
                if isinstance(line, dict):
                    self.event(line['type'], **{key: value for key, value in line.items() if key != 'type'})
                    return
                if line.startswith(PROGRESS_PREFIX):
                    try:
                        progress = json.loads(line[len(PROGRESS_PREFIX):])
                        if not isinstance(progress, dict):
                            raise ValueError()
                        stage = 'postprocess' if progress.get('postprocessor') else 'download'
                        self.event('progress', stage=stage, **{
                            key: progress.get(key) for key in (
                                'status', 'downloaded_bytes', 'total_bytes',
                                'total_bytes_estimate', 'speed', 'eta', 'fragment_index', 'fragment_count')})
                        return
                    except (ValueError, TypeError):
                        pass
                LOGGER.info('%s', line)
                self.event('log', message=line)

            output = download_video(url, download_type, Path(temporary.name), on_output)
            STORAGE.check()
            token = DOWNLOAD_FILES.add(temporary, output)
            self.event('ready', url=f'/api/download/{token}', filename=output.name)
        except ConnectionError:
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
                    self.error(507 if isinstance(exc, DownloadError) else 500, message)
            except ConnectionError:
                pass
        finally:
            if temporary and not token:
                temporary.cleanup()
            DOWNLOAD_SLOTS.release()


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    ThreadingHTTPServer((os.environ.get('HOST', '127.0.0.1'), 8000), DownloadHandler).serve_forever()
