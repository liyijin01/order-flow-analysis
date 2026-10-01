from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from scripts.c4_1_golden import load_range
from scripts.d10_build_levels import (
    build_symbol,
    expected_ids,
    monthly_tpo_levels,
    quarter_levels,
    target_periods,
)


class D10LevelTests(unittest.TestCase):
    def test_eth_2026q2_quarter_matches_golden(self):
        spec = {
            "kind": "quarter",
            "label": "Q2",
            "start": datetime(2026, 4, 1, tzinfo=timezone.utc),
            "end": datetime(2026, 7, 1, tzinfo=timezone.utc),
        }
        vwap, vah, val, _ = quarter_levels("ETHUSDT", spec, load_range)
        expected = (2008.09, 2295.37, 1720.81)
        for actual, ref in zip((vwap, vah, val), expected):
            self.assertLessEqual(abs(actual - ref) / ref, 0.0005)

    def test_eth_2025nov_tpo_val_matches_reference(self):
        spec = {
            "kind": "py-month",
            "label": "PY Nov",
            "start": datetime(2025, 11, 1, tzinfo=timezone.utc),
            "end": datetime(2025, 12, 1, tzinfo=timezone.utc),
        }
        _vah, val, _ = monthly_tpo_levels("ETHUSDT", spec, load_range)
        self.assertLessEqual(abs(val - 2705.89) / 2705.89, 0.003)

    def test_complete_cache_does_not_download(self):
        cutoff = datetime(2026, 10, 1, tzinfo=timezone.utc)
        rows = []
        for spec in target_periods(cutoff):
            for side in ("VAH", "VAL"):
                level_id = next(x for x in expected_ids(spec) if x.endswith(side.lower()))
                rows.append({
                    "id": level_id,
                    "label": f"{spec['label']} {side}",
                    "kind": spec["kind"],
                    "side": side,
                    "price": 100.0,
                    "periodStart": spec["start"].isoformat().replace("+00:00", "Z"),
                    "periodEnd": spec["end"].isoformat().replace("+00:00", "Z"),
                    "definition": "cached",
                })
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp) / "cache.json"
            out = Path(tmp) / "out.json"
            cache.write_text(json.dumps({"levels": rows}), encoding="utf-8")
            with patch("scripts.d10_build_levels.load_range", side_effect=AssertionError("download called")) as mocked:
                payload, computed = build_symbol("ETHUSDT", cutoff, cache, out)
            self.assertEqual(computed, [])
            self.assertEqual(mocked.call_count, 0)
            self.assertEqual(len(payload["levels"]), len(rows))


if __name__ == "__main__":
    unittest.main()
