import http.client
import ipaddress
from io import BytesIO, StringIO
import json
import socket
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch
from urllib.parse import unquote, urlencode

from server import (DOWNLOAD_FILES, DOWNLOAD_SLOTS, DownloadFiles, DownloadHandler,
                    ThreadingHTTPServer, validate_url, StorageGuard, RateLimiter,
                    client_identity, download_video, DownloadError)
from server import run_monitored, read_metadata, DOWNLOAD_LINK_SECONDS


class DownloadTests(unittest.TestCase):
    def setUp(self):
        rate_patch = patch('server.RATE_LIMITER', RateLimiter())
        rate_patch.start()
        self.addCleanup(rate_patch.stop)
        storage_directory = tempfile.TemporaryDirectory()
        self.addCleanup(storage_directory.cleanup)
        guard = StorageGuard()
        guard.root = Path(storage_directory.name)
        guard.min_free = 0
        storage_patch = patch('server.STORAGE', guard)
        storage_patch.start()
        self.addCleanup(storage_patch.stop)
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), DownloadHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.outputs = []
        self.output_basename = 'Test video [abc]'
        # Never read a developer's real cookie export while running tests.
        cookies_directory = tempfile.TemporaryDirectory()
        self.addCleanup(cookies_directory.cleanup)
        self.cookies_source = Path(cookies_directory.name) / 'cookies.txt'
        cookies_patch = patch('server.COOKIES_FILE', self.cookies_source)
        cookies_patch.start()
        self.addCleanup(cookies_patch.stop)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        for token in list(DOWNLOAD_FILES.files):
            DOWNLOAD_FILES.discard(token)
        for output in self.outputs:
            self.assertFalse(output.parent.exists(), 'Temporary directory was not removed')

    def request(self, fields=None, path='/api/download', method='POST'):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        connection.request(method, path, urlencode(fields or {'url': 'https://youtu.be/abc'}) if method == 'POST' else None,
                           {'Content-Type': 'application/x-www-form-urlencoded'})
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def events(self, fields=None):
        status, headers, body = self.request(fields)
        self.assertEqual(status, 200)
        self.assertEqual(headers['Content-Type'], 'application/x-ndjson')
        return [json.loads(line) for line in body.splitlines()]

    def metadata(self, args, *extra, **kwargs):
        self.assertIn('--dump-single-json', args)
        return '{"is_live": true}'

    def media(self, args, **kwargs):
        self.assertNotIn('timeout', kwargs)
        self.assertNotIn('--max-filesize', args)
        self.assertNotIn('--match-filter', args)
        self.assertIn('--newline', args)
        self.assertIn('--progress', args)
        if '--extract-audio' in args:
            self.assertEqual(args[args.index('-f') + 1], 'ba/b')
            audio_format = args[args.index('--audio-format') + 1]
            if audio_format == 'best':
                self.assertNotIn('--audio-quality', args)
                extension = 'opus'
            else:
                self.assertEqual(audio_format, 'mp3')
                self.assertEqual(args[args.index('--audio-quality') + 1], '0')
                extension = 'mp3'
        elif '--merge-output-format' in args:
            self.assertEqual(args[args.index('-f') + 1], "bv[ext=mp4]+ba[ext~='^(m4a|aac)$']")
            self.assertEqual(args[args.index('--merge-output-format') + 1], 'mp4')
            self.assertNotIn('--remux-video', args)
            extension = 'mp4'
        else:
            self.assertNotIn('--merge-output-format', args)
            self.assertEqual(args[args.index('-f') + 1], 'bv*+ba/b')
            extension = 'webm'
        self.assertNotIn('-o', args)
        output = Path(args[args.index('-P') + 1]) / f'{self.output_basename}.{extension}'
        self.outputs.append(output)
        output.write_bytes(b'video content')
        Path(args[args.index('--print-to-file') + 2]).write_text(str(output), encoding='utf-8')
        process = Mock()
        process.stderr = StringIO()
        process.stdout = StringIO('[download] 50% of 10 MiB\n[download] 100%\n')
        process.poll.return_value = 0
        process.wait.return_value = 0
        return process

    def test_url_validation(self):
        for url in ('https://youtu.be/abc', 'https://www.youtube.com/watch?v=abc', 'https://vimeo.com/123'):
            self.assertEqual(validate_url(url), url)
        for url in (None, 42, 'http://youtube.com/a', 'https://localhost/a',
                    'https://youtube.com.evil.example/a', 'https://youtube.com:8000/a',
                    'https://user:pass@youtube.com/a', 'file:///etc/passwd'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                validate_url(url)

    def test_formats_output_and_one_time_download(self):
        for option, extension, mime in (('default', 'webm', 'video/webm'),
                                        ('best_audio', 'opus', 'audio/ogg'),
                                        ('mp4', 'mp4', 'video/mp4'), ('mp3', 'mp3', 'audio/mpeg')):
            with self.subTest(option=option), patch('server.read_metadata', side_effect=self.metadata), \
                    patch('server.subprocess.Popen', side_effect=self.media):
                events = self.events({'url': 'https://youtu.be/abc', 'format': option})
                self.assertTrue(any('50%' in event.get('message', '') for event in events))
                ready = events[-1]
                self.assertEqual(ready['type'], 'ready')
                self.assertEqual(ready['filename'], f'{self.output_basename}.{extension}')
                status, headers, body = self.request(path=ready['url'], method='GET')
                self.assertEqual(status, 200)
                self.assertEqual(headers['Content-Type'], mime)
                filename = unquote(headers['Content-Disposition'].split("filename*=UTF-8''", 1)[1])
                self.assertEqual(filename, ready['filename'])
                self.assertEqual(body, b'video content')
                self.assertEqual(self.request(path=ready['url'], method='GET')[0], 404)

    def test_missing_cookies_uses_anonymous_requests(self):
        with patch('server.read_metadata', side_effect=self.metadata) as metadata, \
                patch('server.subprocess.Popen', side_effect=self.media) as media:
            self.assertEqual(self.events()[-1]['type'], 'ready')
            self.assertNotIn('--cookies', metadata.call_args.args[0])
            self.assertNotIn('--cookies', media.call_args.args[0])

    def test_cookies_are_copied_and_used_for_both_commands(self):
        original = '# Netscape HTTP Cookie File\n# synthetic test cookies\n'
        self.cookies_source.write_text(original, encoding='utf-8')
        copies = []

        def metadata(args, *extra, **kwargs):
            cookies = Path(args[args.index('--cookies') + 1])
            self.assertNotEqual(cookies, self.cookies_source)
            self.assertEqual(cookies.read_text(encoding='utf-8'), original)
            copies.append(cookies)
            cookies.write_text('# updated working cookies\n', encoding='utf-8')
            return self.metadata(args, **kwargs)

        def media(args, **kwargs):
            cookies = Path(args[args.index('--cookies') + 1])
            self.assertEqual(cookies, copies[-1])
            self.assertEqual(cookies.read_text(encoding='utf-8'), '# updated working cookies\n')
            return self.media(args, **kwargs)

        with patch('server.read_metadata', side_effect=metadata), \
                patch('server.subprocess.Popen', side_effect=media):
            for _ in range(2):
                ready = self.events()[-1]
                self.assertEqual(ready['type'], 'ready')
                self.assertEqual(self.request(path=ready['url'], method='GET')[0], 200)
        self.assertNotEqual(copies[0], copies[1])
        self.assertEqual(self.cookies_source.read_text(encoding='utf-8'), original)
        # tearDown joins the file-transfer handlers before unittest runs cleanups.
        self.addCleanup(lambda: self.assertTrue(all(not cookies.exists() for cookies in copies)))

    def test_cookie_copy_removed_after_failure(self):
        self.cookies_source.write_text('# synthetic test cookies\n', encoding='utf-8')
        copies = []

        def fail(args, *extra, **kwargs):
            copies.append(Path(args[args.index('--cookies') + 1]))
            raise subprocess.CalledProcessError(1, 'yt-dlp', stderr=b'Test failure')

        with patch('server.read_metadata', side_effect=fail), self.assertLogs('server'):
            self.assertEqual(self.events()[-1]['type'], 'error')
        self.assertFalse(copies[0].exists())
        self.assertTrue(self.cookies_source.exists())

    def test_unicode_filename(self):
        self.output_basename = 'Café 日本語 [abc]'
        with patch('server.read_metadata', side_effect=self.metadata), \
                patch('server.subprocess.Popen', side_effect=self.media):
            ready = self.events()[-1]
            self.assertEqual(ready['filename'], f'{self.output_basename}.webm')
            status, headers, _ = self.request(path=ready['url'], method='GET')
            self.assertEqual(status, 200)
            disposition = headers['Content-Disposition']
            self.assertTrue(disposition.isascii())
            self.assertEqual(unquote(disposition.split("filename*=UTF-8''", 1)[1]), ready['filename'])

    def test_output_outside_temporary_directory_rejected(self):
        with tempfile.TemporaryDirectory() as outside:
            external = Path(outside) / 'outside.webm'
            external.write_bytes(b'must not be sent or deleted')

            def media(args, **kwargs):
                process = self.media(args, **kwargs)
                Path(args[args.index('--print-to-file') + 2]).write_text(str(external), encoding='utf-8')
                return process

            with patch('server.read_metadata', side_effect=self.metadata), \
                    patch('server.subprocess.Popen', side_effect=media), self.assertLogs('server'):
                self.assertEqual(self.events()[-1]['type'], 'error')
                self.assertTrue(external.exists())

    def test_progress_arrives_before_download_finishes(self):
        release = threading.Event()

        def download(url, option, directory, on_output):
            on_output('[download] 25%')
            release.wait(3)
            output = directory / 'video.mp4'
            output.write_bytes(b'video')
            self.outputs.append(output)
            return output

        with patch('server.download_video', side_effect=download):
            connection = http.client.HTTPConnection(*self.server.server_address, timeout=5)
            connection.request('POST', '/api/download', urlencode({'url': 'https://youtu.be/abc'}),
                               {'Content-Type': 'application/x-www-form-urlencoded'})
            try:
                response = connection.getresponse()
                first = json.loads(response.readline())
                self.assertEqual(first, {'type': 'log', 'message': '[download] 25%'})
                self.assertFalse(release.is_set())
            finally:
                release.set()
                response.read()
                connection.close()

    def test_invalid_request(self):
        with patch('server.download_video') as download:
            for fields in ({'url': 'https://127.0.0.1/'}, {'url': 'https://youtu.be/abc', 'format': '--exec'},
                           {'url': 'x' * 8192}):
                self.assertEqual(self.request(fields)[0], 400)
            download.assert_not_called()

    def test_structured_progress_and_stages(self):
        def media(args, **kwargs):
            self.assertIn('download:av-progress:%(progress)j', args)
            self.assertIn('postprocess:av-progress:%(progress)j', args)
            process = self.media(args, **kwargs)
            process.stdout = StringIO(
                'av-progress:{"status":"downloading","downloaded_bytes":50,'
                '"total_bytes":100,"speed":25.5,"eta":2}\n'
                'av-progress:{"status":"processing","postprocessor":"FFmpeg"}\n'
                'av-progress:not-json\n')
            return process

        with patch('server.read_metadata', side_effect=self.metadata), \
                patch('server.subprocess.Popen', side_effect=media):
            events = self.events()
        self.assertEqual([event['stage'] for event in events if event['type'] == 'stage'],
                         ['metadata', 'download'])
        progress = [event for event in events if event['type'] == 'progress']
        self.assertEqual(progress[0]['speed'], 25.5)
        self.assertEqual(progress[0]['eta'], 2)
        self.assertEqual(progress[0]['downloaded_bytes'], 50)
        self.assertEqual(progress[1]['stage'], 'postprocess')
        self.assertIsNone(progress[1]['eta'])
        self.assertTrue(any(event.get('message') == 'av-progress:not-json' for event in events))

    def test_silent_disconnect_cleans_request_during_metadata_and_media(self):
        original_popen = subprocess.Popen
        original_event = DownloadHandler.event
        for metadata in (True, False):
            processes = []
            released = threading.Event()
            directories = []

            def spawn(args, **kwargs):
                if args[0] == 'taskkill':
                    return original_popen(args, **kwargs)
                if '-P' in args:
                    directory = Path(args[args.index('-P') + 1])
                    directories.append(directory)
                    (directory / 'partial.part').write_bytes(b'partial')
                process = original_popen([sys.executable, '-c', 'import time; time.sleep(30)'], **kwargs)
                processes.append(process)
                return process

            def event(handler, kind, **data):
                if kind == 'heartbeat':
                    raise BrokenPipeError('disconnected silent client')
                return original_event(handler, kind, **data)

            with self.subTest(metadata=metadata), patch('server.HEARTBEAT_SECONDS', 0.02), \
                    patch('server.subprocess.Popen', side_effect=spawn), \
                    patch.object(DownloadHandler, 'event', event), \
                    patch('server.DOWNLOAD_SLOTS') as slots:
                slots.acquire.return_value = True
                slots.release.side_effect = released.set
                if metadata:
                    self.events()
                else:
                    with patch('server.read_metadata', return_value='{}'):
                        self.events()
                self.assertTrue(released.wait(3))
                self.assertEqual(len(processes), 1)
                self.assertIsNotNone(processes[0].poll())
                self.assertTrue(processes[0].stdout.closed)
                self.assertTrue(processes[0].stderr.closed)
                self.assertTrue(all(not directory.exists() for directory in directories))
                self.assertFalse(DOWNLOAD_FILES.files)
                slots.release.assert_called_once()

    def test_closed_http_socket_stops_silent_metadata(self):
        original_popen = subprocess.Popen
        started = threading.Event()
        released = threading.Event()
        processes = []

        def spawn(args, **kwargs):
            if args[0] == 'taskkill':
                return original_popen(args, **kwargs)
            process = original_popen([sys.executable, '-c', 'import time; time.sleep(30)'], **kwargs)
            processes.append(process)
            started.set()
            return process

        with patch('server.HEARTBEAT_SECONDS', 0.02), \
                patch('server.subprocess.Popen', side_effect=spawn), patch('server.DOWNLOAD_SLOTS') as slots:
            slots.acquire.return_value = True
            slots.release.side_effect = released.set
            connection = http.client.HTTPConnection(*self.server.server_address, timeout=3)
            try:
                connection.request('POST', '/api/download', urlencode({'url': 'https://youtu.be/abc'}),
                                   {'Content-Type': 'application/x-www-form-urlencoded'})
                response = connection.getresponse()
                self.assertEqual(json.loads(response.readline())['stage'], 'metadata')
                self.assertTrue(started.wait(2))
                response.fp.raw._sock.shutdown(socket.SHUT_RDWR)
                response.close()
            finally:
                connection.close()
            self.assertTrue(released.wait(5))
            self.assertIsNotNone(processes[0].poll())
            self.assertTrue(processes[0].stdout.closed)
            self.assertFalse(DOWNLOAD_FILES.files)

    def test_playlist_rejected(self):
        with patch('server.read_metadata', return_value='{"_type": "playlist", "entries": []}'), self.assertLogs('server'):
            events = self.events()
            self.assertEqual(events[-1]['type'], 'error')
            self.assertIn('Playlists', events[-1]['message'])

    def test_invalid_metadata_never_starts_media(self):
        for metadata in ('not json', '[]', 'null'):
            with self.subTest(metadata=metadata), patch('server.read_metadata', return_value=metadata), \
                    patch('server.subprocess.Popen') as media, self.assertLogs('server'):
                self.assertEqual(self.events()[-1]['type'], 'error')
                media.assert_not_called()

    def test_failures_release_slot(self):
        for error in (subprocess.CalledProcessError(1, 'yt-dlp'),
                      subprocess.TimeoutExpired('yt-dlp', 120), RuntimeError('unexpected failure')):
            released = threading.Event()
            with self.subTest(error=error), patch('server.download_video', side_effect=error), \
                    patch('server.DOWNLOAD_SLOTS') as slots, self.assertLogs('server'):
                slots.acquire.return_value = True
                slots.release.side_effect = released.set
                self.assertEqual(self.events()[-1]['type'], 'error')
                self.assertTrue(released.wait(timeout=2))
                slots.release.assert_called_once_with()

    def test_media_failure_removes_partial_files(self):
        def fail(args, *extra, **kwargs):
            process = self.media(args, **kwargs)
            process.poll.return_value = 1
            process.wait.return_value = 1
            return process
        with patch('server.read_metadata', side_effect=self.metadata), \
                patch('server.subprocess.Popen', side_effect=fail), self.assertLogs('server'):
            self.assertEqual(self.events()[-1]['type'], 'error')

    def test_encoded_url_between_four_and_eight_kib(self):
        url = 'https://youtu.be/abc?value=' + ':' * 1800
        self.assertLessEqual(len(url), 2048)
        self.assertGreater(len(urlencode({'url': url})), 4096)
        with patch('server.read_metadata', side_effect=self.metadata), \
                patch('server.subprocess.Popen', side_effect=self.media):
            self.assertEqual(self.events({'url': url})[-1]['type'], 'ready')

    def test_busy(self):
        DOWNLOAD_SLOTS.acquire()
        DOWNLOAD_SLOTS.acquire()
        try:
            self.assertEqual(self.request()[0], 429)
        finally:
            DOWNLOAD_SLOTS.release()
            DOWNLOAD_SLOTS.release()

    def test_rate_limit_rejects_before_extraction(self):
        limiter = RateLimiter()
        limiter.limit = 1
        with patch('server.RATE_LIMITER', limiter), patch('server.download_video') as download:
            self.assertEqual(self.request({'url': 'invalid'})[0], 400)
            self.assertEqual(self.request()[0], 429)
            download.assert_not_called()

    def test_storage_admission_releases_slot(self):
        with patch('server.STORAGE.check', side_effect=DownloadError('storage quota reached')), \
                patch('server.download_video') as download, self.assertLogs('server'):
            status, _, body = self.request()
            self.assertEqual(status, 507)
            self.assertIn(b'quota', body)
            download.assert_not_called()
        self.assertTrue(DOWNLOAD_SLOTS.acquire(blocking=False))
        self.assertTrue(DOWNLOAD_SLOTS.acquire(blocking=False))
        DOWNLOAD_SLOTS.release()
        DOWNLOAD_SLOTS.release()

    def test_unused_link_expires(self):
        store = DownloadFiles()
        temporary = tempfile.TemporaryDirectory()
        output = Path(temporary.name) / 'video.mp4'
        output.touch()
        try:
            with patch('server.DOWNLOAD_LINK_SECONDS', 0.01):
                token = store.add(temporary, output)
            for _ in range(200):
                if not output.exists():
                    break
                time.sleep(0.01)
            self.assertFalse(output.exists())
            self.assertIsNone(store.take(token))
        finally:
            temporary.cleanup()


class ResourceTests(unittest.TestCase):
    def test_event_writes_are_serialized_and_flushed(self):
        handler = object.__new__(DownloadHandler)
        handler.event_lock = threading.Lock()

        class SlowStream(BytesIO):
            flush_count = 0

            def write(self, data):
                for byte in data:
                    super().write(bytes([byte]))
                    time.sleep(0.00001)

            def flush(self):
                self.flush_count += 1

        handler.wfile = SlowStream()
        threads = [threading.Thread(target=handler.event, args=('heartbeat',), kwargs={'index': index})
                   for index in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        events = [json.loads(line) for line in handler.wfile.getvalue().splitlines()]
        self.assertEqual(sorted(event['index'] for event in events), list(range(8)))
        self.assertEqual(handler.wfile.flush_count, 8)

    def test_metadata_drains_large_stderr_without_deadlock(self):
        events = []
        with patch('server.STORAGE', Mock(interval=1)):
            result = read_metadata([sys.executable, '-c',
                                    'import sys; sys.stderr.write("warning\\n" * 20000); print("{}")'],
                                   events.append)
        self.assertEqual(json.loads(result), {})
        self.assertEqual(events.count('warning'), 20000)

    def test_metadata_storage_breach_stops_silent_process(self):
        guard = Mock(interval=0.01)
        guard.check.side_effect = DownloadError('storage quota reached')
        with patch('server.STORAGE', guard):
            with self.assertRaisesRegex(DownloadError, 'quota'):
                read_metadata([sys.executable, '-c', 'import time; time.sleep(30)'], Mock())
        self.assertFalse(any(thread.name == 'download-pipe' for thread in threading.enumerate()))

    def test_token_lifetime_remains_ten_minutes(self):
        self.assertEqual(DOWNLOAD_LINK_SECONDS, 600)

    def test_metadata_json_and_stderr_are_drained_separately(self):
        events = []
        command = [sys.executable, '-c',
                   'import sys; print(\'{"is_live": true}\'); print("metadata warning", file=sys.stderr)']
        with patch('server.STORAGE', Mock(interval=1)):
            self.assertEqual(json.loads(read_metadata(command, events.append)), {'is_live': True})
        self.assertIn('metadata warning', events)

    def test_metadata_timeout_kills_silent_process_and_closes_pipes(self):
        original_popen = subprocess.Popen
        processes = []

        def spawn(*args, **kwargs):
            process = original_popen(*args, **kwargs)
            processes.append(process)
            return process

        with patch('server.subprocess.Popen', side_effect=spawn), \
                patch('server.METADATA_TIMEOUT_SECONDS', 0.05), patch('server.STORAGE', Mock(interval=1)):
            with self.assertRaisesRegex(DownloadError, 'timed out'):
                read_metadata([sys.executable, '-c', 'import time; time.sleep(30)'], Mock())
        self.assertIsNotNone(processes[0].poll())
        self.assertTrue(processes[0].stdout.closed)
        self.assertTrue(processes[0].stderr.closed)
        self.assertFalse(any(thread.name == 'download-pipe' for thread in threading.enumerate()))

    def test_media_has_no_metadata_timeout_and_sends_heartbeats(self):
        events = []
        guard = Mock(interval=0.01)
        with patch('server.METADATA_TIMEOUT_SECONDS', 0.001), \
                patch('server.HEARTBEAT_SECONDS', 0.01), patch('server.STORAGE', guard):
            run_monitored([sys.executable, '-c', 'import time; time.sleep(0.15)'], events.append)
        self.assertIn({'type': 'heartbeat'}, events)
        self.assertGreater(guard.check.call_count, 0)

    def test_output_callback_failure_terminates_real_process(self):
        original_popen = subprocess.Popen
        processes = []

        def spawn(*args, **kwargs):
            process = original_popen(*args, **kwargs)
            processes.append(process)
            return process

        with patch('server.subprocess.Popen', side_effect=spawn), patch('server.STORAGE', Mock(interval=1)):
            with self.assertRaises(ConnectionResetError):
                run_monitored([sys.executable, '-u', '-c',
                               'import time; print("progress"); time.sleep(30)'],
                              Mock(side_effect=ConnectionResetError()))
        self.assertIsNotNone(processes[0].poll())
        self.assertTrue(processes[0].stdout.closed)
        self.assertTrue(processes[0].stderr.closed)

    def test_storage_counts_retained_and_partial_files(self):
        with tempfile.TemporaryDirectory() as root:
            guard = StorageGuard()
            guard.root = Path(root)
            guard.quota = 10
            guard.min_free = 0
            retained = guard.root / 'retained'
            retained.mkdir()
            (retained / 'video.mp4').write_bytes(b'123456')
            partial = guard.root / 'active.part'
            partial.write_bytes(b'1234')
            with self.assertRaisesRegex(DownloadError, 'quota'):
                guard.check()
            partial.unlink()
            guard.check()
            guard.min_free = 100
            with patch('server.shutil.disk_usage', return_value=Mock(free=99)):
                with self.assertRaisesRegex(DownloadError, 'disk space'):
                    guard.check()

    def test_rate_window_and_bounded_clients(self):
        limiter = RateLimiter()
        limiter.limit = 2
        limiter.max_clients = 1
        with patch('server.time.monotonic', return_value=0):
            self.assertTrue(limiter.allow('one'))
            self.assertTrue(limiter.allow('one'))
            self.assertFalse(limiter.allow('one'))
            self.assertFalse(limiter.allow('two'))
        with patch('server.time.monotonic', return_value=limiter.window):
            self.assertTrue(limiter.allow('two'))

    def test_forwarding_requires_trusted_peer_and_chain(self):
        with patch('server.TRUSTED_PROXY_NETWORKS', (ipaddress.ip_network('10.0.0.0/24'),)):
            self.assertEqual(client_identity('192.0.2.1', '198.51.100.1'), '192.0.2.1')
            self.assertEqual(client_identity('10.0.0.2', '198.51.100.1'), '198.51.100.1')
            self.assertEqual(client_identity('10.0.0.2', '192.0.2.8, 198.51.100.1'), '198.51.100.1')
            self.assertEqual(client_identity('10.0.0.2', '192.0.2.8, 10.0.0.3'), '192.0.2.8')
            self.assertEqual(client_identity('10.0.0.2', 'invalid'), '10.0.0.2')

    def test_silent_media_is_stopped_on_storage_breach(self):
        released = threading.Event()
        process = Mock()
        process.stderr = StringIO()
        process.poll.return_value = None
        process.stdout.readline.side_effect = lambda size: (released.wait(3) and '')
        process.wait.return_value = 1
        guard = Mock(interval=0.01)
        guard.check.side_effect = [None, None, DownloadError('storage quota reached')]
        def stop(media):
            self.assertIs(media, process)
            released.set()
        with tempfile.TemporaryDirectory() as root, \
                patch('server.STORAGE', guard), \
                patch('server.COOKIES_FILE', Path(root) / 'absent'), \
                patch('server.read_metadata', return_value='{}'), \
                patch('server.subprocess.Popen', return_value=process), \
                patch('server.stop_process', side_effect=stop) as stopped:
            with self.assertRaisesRegex(DownloadError, 'quota'):
                download_video('https://youtu.be/abc', 'default', Path(root), Mock())
            self.assertTrue(released.is_set())
            self.assertGreaterEqual(stopped.call_count, 1)

    def test_posix_kills_group_even_when_leader_has_exited(self):
        from server import stop_process
        process = Mock(pid=123)
        process.poll.return_value = 0
        with patch('server.os.name', 'posix'), patch('server.signal.SIGKILL', 9, create=True), \
                patch('server.os.killpg', create=True) as kill:
            stop_process(process)
            kill.assert_called_once_with(123, 9)


if __name__ == '__main__':
    unittest.main()
