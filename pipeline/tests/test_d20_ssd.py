"""Deterministic unit tests; no network or API key is needed."""
import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.d20_build_ssd import (
    aggregate_backfill, append_if_absent, build_ssd, calibrate,
    daily_point, top_125, utc_daily_values, migrate_close_dates, daily_close_point,
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
        self.assertEqual(utc_daily_values(chart), {"2026-10-04": 101.0})
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
                [{"date": "2026-10-03", "raw": 8.88}],
            )


    def test_migration_shifts_once_and_flags_legacy_intraday_sample(self):
        original = {
            "points": [
                {"date": "2026-10-04", "raw": 9.04, "fetchedAt": "2026-10-10T03:00:00Z"},
                {"date": "2026-10-10", "raw": 9.2, "fetchedAt": "2026-10-10T15:00:00Z"},
            ]
        }
        self.assertTrue(migrate_close_dates(original))
        self.assertEqual([p["date"] for p in original["points"]],
                         ["2026-10-03", "2026-10-09"])
        self.assertTrue(original["points"][-1]["approx"])
        self.assertFalse(migrate_close_dates(original))
        self.assertEqual(original["points"][0]["date"], "2026-10-03")

    def test_daily_close_uses_midnight_and_not_live_market_cap(self):
        midnight = int(dt.datetime(2026, 10, 11, tzinfo=dt.timezone.utc).timestamp() * 1000)
        class FakeClient:
            def history(self, coin_id, days=365):
                self_days.append(days)
                values = {"tether": 8, "usd-coin": 2, "dai": 1, "alpha": 30}
                return {"market_caps": [[midnight, values[coin_id]]]}
        self_days = []
        row = daily_close_point(FakeClient(), ["alpha"], "2026-10-10",
                                "2026-10-11T03:00:00Z")
        self.assertEqual(self_days, [2, 2, 2, 2])
        self.assertEqual(row["date"], "2026-10-10")
        self.assertFalse(row["approx"])
        self.assertAlmostEqual(row["raw"], 11 / 30 * 100)

    def test_daily_close_failure_falls_back_to_approx(self):
        with tempfile.TemporaryDirectory() as root:
            cache_dir = Path(root) / "macro"
            cache_dir.mkdir()
            constituents = ["coin-" + str(i) for i in range(125)]
            points = [{"date": "2026-10-09", "raw": 9.118,
                       "total": 100, "fetchedAt": "2026-10-10T02:00:00Z"}]
            cached = {"schema": "ssd-v1", "dateBasis": "utc-close-day",
                      "constituentsUpdatedAt": "2026-10-01T00:00:00Z",
                      "constituents": constituents, "points": points}
            (cache_dir / "ssd.json").write_text(json.dumps(cached))
            class FailHistory:
                def market_rows(self, category=None, max_pages=4):
                    ids = constituents + list(("tether", "usd-coin", "dai"))
                    return [{"id": id_, "market_cap": 100} for id_ in ids]
                def history(self, coin_id, days=365):
                    raise RuntimeError("mocked history failure")
            fake_rules = Path(root) / "config.json"
            fake_rules.write_text(json.dumps({"ssd": {
                "calibration": {"date": "2026-10-09", "tvValue": 9.118}
            }}))
            result = build_ssd(
                cache_dir, Path(root) / "out", key="unit-test-key",
                today=dt.datetime(2026, 10, 11, tzinfo=dt.timezone.utc),
                client=FailHistory(), rules_path=fake_rules
            )
            today = next(p for p in result["points"] if p["date"] == "2026-10-10")
            self.assertTrue(today["approx"])
            self.assertEqual(len(result["points"]), 2)


if __name__ == "__main__":
    unittest.main()
