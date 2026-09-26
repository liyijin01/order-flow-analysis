import hashlib
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from pipeline.vision import download_verified_day


class VisionTests(unittest.TestCase):
    def test_404_checksum_marks_day_missing(self):
        with tempfile.TemporaryDirectory() as tmp, patch("pipeline.vision.fetch_text", return_value=("missing", None)):
            result = download_verified_day("BTCUSDT", date(2026, 9, 25), Path(tmp), sleep=lambda _: None)
        self.assertEqual(result.status, "missing")

    def test_checksum_mismatch_redownloads_once(self):
        good = b"good-zip-bytes"
        expected = hashlib.sha256(good).hexdigest()
        calls = []

        def fake_download(url, destination, retries=3, sleep=None):
            calls.append(url)
            destination.write_bytes(b"wrong" if len(calls) == 1 else good)
            return "ok", None

        with tempfile.TemporaryDirectory() as tmp, \
             patch("pipeline.vision.fetch_text", return_value=("ok", expected + "  file.zip")), \
             patch("pipeline.vision._download_file", side_effect=fake_download):
            result = download_verified_day("BTCUSDT", date(2026, 9, 24), Path(tmp), sleep=lambda _: None)
        self.assertEqual(result.status, "ok")
        self.assertEqual(len(calls), 2)
        self.assertEqual(result.sha256, expected)


if __name__ == "__main__":
    unittest.main()
