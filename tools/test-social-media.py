"""Real FFmpeg regression checks; run with the downloader virtualenv."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('worker', Path(__file__).with_name('social-media.py'))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

class NormalizationTests(unittest.TestCase):
    def setUp(self):
        self.previous = Path.cwd()
        self.temp = tempfile.TemporaryDirectory()
        os.chdir(self.temp.name)

    def tearDown(self):
        os.chdir(self.previous)
        self.temp.cleanup()

    def fixture(self, audio):
        args = ['ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'lavfi',
                '-i', 'testsrc2=size=320x240:rate=30:duration=1']
        if audio:
            args += ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1']
        subprocess.run(args + ['-c:v', 'mpeg4', '-pix_fmt', 'yuv420p',
                              '-c:a', 'aac', 'media-01.mp4'], check=True)

    def test_valid_video_with_and_without_audio(self):
        for audio in (True, False):
            with self.subTest(audio=audio):
                self.fixture(audio)
                worker.prepare_videos()
                result = worker.probe_media('media-01.mp4')
                video = next(s for s in result['streams'] if s['codec_type'] == 'video')
                self.assertEqual((video['codec_name'], video['pix_fmt']), ('h264', 'yuv420p'))
                tracks = [s for s in result['streams'] if s['codec_type'] == 'audio']
                self.assertEqual([s['codec_name'] for s in tracks], ['aac'] if audio else [])
                self.assertAlmostEqual(float(result['format']['duration']), 1, delta=0.1)
                self.assertLessEqual(Path('media-01.mp4').stat().st_size, worker.LIMIT)

    def test_corrupt_file_rejected(self):
        Path('media-01.mp4').write_bytes(b'corrupt video')
        with self.assertRaises(subprocess.CalledProcessError):
            worker.prepare_videos()
        self.assertFalse(Path('media-01.ready.mp4').exists())

    def test_failed_conversion_does_not_replace_source(self):
        self.fixture(True)
        original = Path('media-01.mp4').read_bytes()
        limit = worker.LIMIT
        try:
            worker.LIMIT = 128
            with self.assertRaises(ValueError):
                worker.prepare_videos()
        finally:
            worker.LIMIT = limit
        self.assertEqual(Path('media-01.mp4').read_bytes(), original)
        self.assertFalse(Path('media-01.ready.mp4').exists())

if __name__ == '__main__':
    unittest.main()
