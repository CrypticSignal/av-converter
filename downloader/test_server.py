import http.client
from io import StringIO
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch
from urllib.parse import unquote, urlencode

from server import (DOWNLOAD_FILES, DOWNLOAD_SLOTS, DownloadFiles, DownloadHandler,
                    ThreadingHTTPServer, validate_url)


class DownloadTests(unittest.TestCase):
    def setUp(self):
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

    def metadata(self, args, **kwargs):
        self.assertIn('--dump-single-json', args)
        self.assertTrue(kwargs['check'])
        return subprocess.CompletedProcess(args, 0, b'{"is_live": true}', b'')

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
            with self.subTest(option=option), patch('server.subprocess.run', side_effect=self.metadata), \
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
        with patch('server.subprocess.run', side_effect=self.metadata) as metadata, \
                patch('server.subprocess.Popen', side_effect=self.media) as media:
            self.assertEqual(self.events()[-1]['type'], 'ready')
            self.assertNotIn('--cookies', metadata.call_args.args[0])
            self.assertNotIn('--cookies', media.call_args.args[0])

    def test_cookies_are_copied_and_used_for_both_commands(self):
        original = '# Netscape HTTP Cookie File\n# synthetic test cookies\n'
        self.cookies_source.write_text(original, encoding='utf-8')
        copies = []

        def metadata(args, **kwargs):
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

        with patch('server.subprocess.run', side_effect=metadata), \
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

        def fail(args, **kwargs):
            copies.append(Path(args[args.index('--cookies') + 1]))
            raise subprocess.CalledProcessError(1, 'yt-dlp', stderr=b'Test failure')

        with patch('server.subprocess.run', side_effect=fail), self.assertLogs('server'):
            self.assertEqual(self.events()[-1]['type'], 'error')
        self.assertFalse(copies[0].exists())
        self.assertTrue(self.cookies_source.exists())

    def test_unicode_filename(self):
        self.output_basename = 'Café 日本語 [abc]'
        with patch('server.subprocess.run', side_effect=self.metadata), \
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

            with patch('server.subprocess.run', side_effect=self.metadata), \
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

    def test_playlist_rejected(self):
        with patch('server.subprocess.run', return_value=subprocess.CompletedProcess(
                [], 0, b'{"_type": "playlist", "entries": []}', b'')), self.assertLogs('server'):
            events = self.events()
            self.assertEqual(events[-1]['type'], 'error')
            self.assertIn('Playlists', events[-1]['message'])

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
        def fail(args, **kwargs):
            process = self.media(args, **kwargs)
            process.poll.return_value = 1
            process.wait.return_value = 1
            return process
        with patch('server.subprocess.run', side_effect=self.metadata), \
                patch('server.subprocess.Popen', side_effect=fail), self.assertLogs('server'):
            self.assertEqual(self.events()[-1]['type'], 'error')

    def test_encoded_url_between_four_and_eight_kib(self):
        url = 'https://youtu.be/abc?value=' + ':' * 1800
        self.assertLessEqual(len(url), 2048)
        self.assertGreater(len(urlencode({'url': url})), 4096)
        with patch('server.subprocess.run', side_effect=self.metadata), \
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


if __name__ == '__main__':
    unittest.main()
