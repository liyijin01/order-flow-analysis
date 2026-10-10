"""Deterministic unit tests; no network or API key is needed."""
import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.d20_build_ssd import (
    aggregate_backfill, append_if_absent, build_ssd, calibrate,
    daily_point, top_125, utc_daily_values,
)


class TestStablecoinDominance(unittest.TestCase):
    def test_top_125_excludes_wrapped_and_liquid_staking(self):
        rows = [
            {"id": "coin-" + str(i), "market_cap": 500 - i}
            for i in range(135)
        ]
        members = top_125(rows, {"coin-0", "coin-2", "coin-4"})
        self.assertEqual(len(members), 125)
        self.assertNotIn("coin-0", members)
        self.assertNotIn("coin-2", members)
        self.assertNotIn("coin-4", members)
        self.assertEqual(members[0], "coin-1")
        self.assertEqual(members[-1], "coin-127")

    def test_midnight_filter_and_daily_aggregate_missing(self):
        midnight = int(dt.datetime(2026, 10, 5, tzinfo=dt.timezone.utc).timestamp() * 1000)
        chart = {"market_caps": [
            [midnight - 3600_000, 77], [midnight, 101],
            [midnight + 3600_000, 999],
        ]}
        self.assertEqual(utc_daily_values(chart), {"2026-10-05": 101.0})
        charts = {
            "tether": {"2026-10-05": 8},
            "usd-coin": {"2026-10-05": 2},
            "dai": {"2026-10-05": 1},
            "alpha": {"2026-10-05": 30},
            # beta is missing and thus counted as 0
        }
        result = aggregate_backfill(charts, ["alpha", "beta"], "2026-10-06T00:00:00Z")
        self.assertEqual(len(result), 1)
        self.assertAlmostEqual(result[0]["raw"], 11 / 30 * 100)
        self.assertEqual(result[0]["total"], 30)
        self.assertEqual(result[0]["missingCoins"], 1)

    def test_no_same_day_overwrite(self):
        points = [{"date": "2026-10-05", "raw": 9.01}]
        self.assertFalse(append_if_absent(points, {"date": "2026-10-05", "raw": 99}))
        self.assertEqual(points[0]["raw"], 9.01)
        self.assertTrue(append_if_absent(points, {"date": "2026-10-06", "raw": 9.02}))

    def test_daily_point_uses_fixed_constituents(self):
        markets = [
            {"id": "alpha", "market_cap": 100},
            {"id": "beta", "market_cap": 50},
            {"id": "tether", "market_cap": 9},
            {"id": "usd-coin", "market_cap": 7},
            {"id": "dai", "market_cap": 5},
        ]
        p = daily_point(markets, ["alpha", "beta"], "2026-10-05", "2026-10-06T00:01:00Z")
        self.assertAlmostEqual(p["raw"], 21 / 150 * 100)
        self.assertEqual(p["missingCoins"], 0)

    def test_calibration(self):
        row = {"points": [{"date": "2026-10-05", "raw": 9.118 * 1.035}]}
        ratio = calibrate(row, "2026-10-05", 9.118)
        self.assertAlmostEqual(ratio, 1.035)
        self.assertAlmostEqual(row["points"][0]["raw"] / ratio, 9.118)

    def test_no_key_preserves_cache_and_returns_without_network(self):
        with tempfile.TemporaryDirectory() as root:
            cache_path = Path(root) / "macro" / "ssd.json"
            cache_path.parent.mkdir()
            old = {
                "schema": "ssd-v1", "points": [{"date": "2026-10-04", "raw": 8.88}],
                "generatedAt": "2026-10-05T00:00:00Z",
            }
            cache_path.write_text(json.dumps(old), encoding="utf-8")
            with patch.dict("os.environ", {"COINGECKO_DEMO_API_KEY": ""}):
                result = build_ssd(
                    cache_path.parent, Path(root) / "out", today=dt.datetime(
                        2026, 10, 6, tzinfo=dt.timezone.utc,
                    )
                )
            self.assertEqual(len(result["points"]), 1)
            self.assertEqual(result["generatedAt"], "2026-10-05T00:00:00Z")
            self.assertEqual(
                json.loads((Path(root) / "out" / "ssd.json").read_text())["points"],
                old["points"],
            )


if __name__ == "__main__":
    unittest.main()
