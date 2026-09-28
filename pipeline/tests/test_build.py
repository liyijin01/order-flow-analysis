import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from pipeline.build import build_all


class BuildTests(unittest.TestCase):
    def test_all_missing_refuses_empty_publish(self):
        config = {"BTCUSDT": {"base": "BTC", "ladderBin": "1", "defaultRow": "10", "weeklyRows": ["10"]}}
        warnings = []
        with tempfile.TemporaryDirectory() as tmp, patch("pipeline.build.ensure_day", return_value=("missing", None, None)):
            root = Path(tmp)
            with self.assertRaises(RuntimeError):
                build_all(config, root / "data", root / "out", date(2026, 9, 26), warn=warnings.append)
        self.assertTrue(any("previous completed week is incomplete" in msg for msg in warnings))


if __name__ == "__main__":
    unittest.main()
