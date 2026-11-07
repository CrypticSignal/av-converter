"""Offline checks of the downloader's inputs and outputs. yt-dlp is never run."""
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
        self.enterContext(patch.object(server, 'check_free_space'))
        self.enterContext(patch.object(server, 'COOKIES_FILE', self.root / 'cookies.txt'))
        self.metadata = self.enterContext(patch.object(server, 'read_metadata', return_value='{}'))
        self.media = self.enterContext(patch.object(server, 'run_download', side_effect=self.write_manifest))

    def write_manifest(self, args, on_output):
        (self.directory / 'result.txt').write_text(str(self.output), encoding='utf-8')

    def download(self, option='default'):
        return server.download_video('https://youtu.be/abc', option, self.directory, Mock())

    def test_download_options(self):
        for option, expected in server.DOWNLOAD_TYPES.items():
            with self.subTest(format=option):
                self.assertEqual(self.download(option), self.output)
                args = self.media.call_args.args[0]
                start = args.index('-f')
                self.assertEqual(args[start:start + len(expected)], expected)

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


class UrlTests(unittest.TestCase):
    def test_url_validation(self):
        for url in ('https://youtu.be/abc', 'https://www.youtube.com/watch?v=abc', 'https://vimeo.com/123'):
            self.assertEqual(server.validate_url(url), url)
        for url in (None, 'http://youtube.com/a', 'https://localhost/a',
                    'https://youtube.com.evil.example/a', 'https://user:pass@youtube.com/a'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                server.validate_url(url)


if __name__ == '__main__':
    unittest.main()
