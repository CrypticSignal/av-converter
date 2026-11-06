"""Small, offline checks of downloader inputs, files, and limits."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import server


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.directory = self.root / 'download'
        self.directory.mkdir()
        self.output = self.directory / 'video.webm'
        self.output.write_bytes(b'video')
        self.enterContext(patch.object(server, 'STORAGE', Mock()))
        self.enterContext(patch.object(server, 'COOKIES_FILE', self.root / 'cookies.txt'))
        self.metadata = self.enterContext(patch.object(server, 'read_metadata', return_value='{}'))
        self.media = self.enterContext(patch.object(server, 'run_monitored', side_effect=self.write_manifest))

    def write_manifest(self, args, on_output):
        (self.directory / 'result.txt').write_text(str(self.output), encoding='utf-8')

    def download(self, option='default'):
        return server.download_video('https://youtu.be/abc', option, self.directory, Mock())

    def test_download_options_and_output(self):
        for option, expected in (
            ('default', ['-f', 'bv*+ba/b']),
            ('best_audio', ['-f', 'ba/b', '--extract-audio', '--audio-format', 'best']),
            ('mp4', ['-f', "bv[ext=mp4]+ba[ext~='^(m4a|aac)$']", '--merge-output-format', 'mp4']),
            ('mp3', ['-f', 'ba/b', '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0']),
        ):
            with self.subTest(format=option):
                self.assertEqual(self.download(option), self.output)
                args = self.media.call_args.args[0]
                start = args.index('-f')
                self.assertEqual(args[start:start + len(expected)], expected)
                self.assertNotIn('--max-filesize', args)
                self.assertNotIn('--cookies', args)

    def test_invalid_metadata_and_playlists_are_rejected(self):
        for metadata in ('not json', '[]', '{"_type":"playlist","entries":[]}'):
            with self.subTest(metadata=metadata):
                self.metadata.return_value = metadata
                with self.assertRaises((ValueError, server.DownloadError)):
                    self.download()
                self.media.assert_not_called()

    def test_output_outside_download_directory_is_rejected(self):
        self.output = self.root / 'outside.webm'
        self.output.write_bytes(b'keep this file')
        with self.assertRaisesRegex(server.DownloadError, 'valid output file'):
            self.download()
        self.assertEqual(self.output.read_bytes(), b'keep this file')

    def test_cookies_are_copied_for_both_commands(self):
        server.COOKIES_FILE.write_text('# synthetic test cookies\n')
        self.download()
        copy = self.directory / 'cookies.txt'
        self.assertEqual(copy.read_bytes(), server.COOKIES_FILE.read_bytes())
        for args in (self.metadata.call_args.args[0], self.media.call_args.args[0]):
            self.assertEqual(args[args.index('--cookies') + 1], str(copy))
        copy.write_text('# working copy changed\n')
        self.assertEqual(server.COOKIES_FILE.read_text(), '# synthetic test cookies\n')


class ResourceTests(unittest.TestCase):
    def test_url_validation(self):
        for url in ('https://youtu.be/abc', 'https://www.youtube.com/watch?v=abc', 'https://vimeo.com/123'):
            self.assertEqual(server.validate_url(url), url)
        for url in (None, 42, 'http://youtube.com/a', 'https://localhost/a',
                    'https://youtube.com.evil.example/a', 'https://youtube.com:8000/a',
                    'https://user:pass@youtube.com/a', 'file:///etc/passwd'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                server.validate_url(url)

    def test_two_jobs_per_client_and_released_capacity(self):
        limits = server.ClientLimits(server.MAX_DOWNLOADS_PER_CLIENT)
        self.assertTrue(limits.acquire('a'))
        self.assertTrue(limits.acquire('a'))
        self.assertFalse(limits.acquire('a'))
        self.assertTrue(limits.acquire('b'))
        limits.release('a')
        self.assertTrue(limits.acquire('a'))

    def test_free_space_reserve(self):
        with tempfile.TemporaryDirectory() as root, patch.object(server.shutil, 'disk_usage') as usage:
            guard = server.StorageGuard()
            guard.root = Path(root)
            guard.min_free = 100
            usage.return_value = Mock(free=100)
            guard.check()
            guard.measurement = None
            usage.return_value = Mock(free=99)
            with self.assertRaisesRegex(server.DownloadError, 'disk space'):
                guard.check()

    def test_links_can_only_be_claimed_once(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        output = Path(temporary.name) / 'video.mp4'
        output.touch()
        store = server.DownloadFiles()
        with patch.object(server.threading, 'Timer'):
            token = store.add(temporary, output)
        self.assertEqual(store.take(token), (temporary, output))
        self.assertIsNone(store.take(token))

    def test_discarding_a_link_removes_its_files(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        output = Path(temporary.name) / 'video.mp4'
        output.touch()
        store = server.DownloadFiles()
        with patch.object(server.threading, 'Timer'):
            token = store.add(temporary, output)
        store.discard(token)
        self.assertFalse(output.parent.exists())
        self.assertIsNone(store.take(token))


if __name__ == '__main__':
    unittest.main()
