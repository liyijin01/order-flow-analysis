from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from scripts.c4_1_golden import Bar, load_range
from scripts.d10_build_levels import (
    build_symbol,
    expected_ids,
    monthly_tpo_levels,
    quarter_levels,
    target_periods,
    year_levels,
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
            sides = ("VWAP", "VAH", "VAL") if spec["kind"] == "year" else ("VAH", "VAL")
            for side in sides:
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
                    "bars": 1,
                    "expectedBars": 1,
                    "complete": True,
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

    @staticmethod
    def _cached_rows(cutoff, skip_label=None, legacy_label=None):
        rows = []
        for spec in target_periods(cutoff):
            if spec["label"] == skip_label:
                continue
            sides = ("VWAP", "VAH", "VAL") if spec["kind"] == "year" else ("VAH", "VAL")
            for side in sides:
                level_id = next(x for x in expected_ids(spec) if x.endswith(side.lower()))
                row = {
                    "id": level_id,
                    "label": f"{spec['label']} {side}",
                    "kind": spec["kind"],
                    "side": side,
                    "price": 100.0,
                    "periodStart": spec["start"].isoformat().replace("+00:00", "Z"),
                    "periodEnd": spec["end"].isoformat().replace("+00:00", "Z"),
                    "definition": "cached",
                }
                if spec["label"] != legacy_label:
                    row.update({"bars": 1, "expectedBars": 1, "complete": True})
                rows.append(row)
        return rows

    @staticmethod
    def _bars(spec, interval, missing_indexes=()):
        step_ms = {"30m": 1800_000, "1h": 3600_000, "4h": 14_400_000}[interval]
        start_ms = int(spec["start"].timestamp() * 1000)
        end_ms = int(spec["end"].timestamp() * 1000)
        count = (end_ms - start_ms) // step_ms
        missing = set(missing_indexes)
        return [
            Bar(start_ms + i * step_ms, 100.0, 101.0, 99.0, 100.0, 1.0, 0.5)
            for i in range(count)
            if i not in missing
        ]

    def test_incomplete_final_day_is_not_cached(self):
        cutoff = datetime(2026, 10, 1, tzinfo=timezone.utc)
        q3 = next(spec for spec in target_periods(cutoff) if spec["label"] == "Q3")
        expected = int((q3["end"] - q3["start"]).total_seconds() // 3600)
        rows = self._cached_rows(cutoff, skip_label="Q3")

        def fake_load(_symbol, _market, interval, start, end):
            self.assertEqual((start, end, interval), (q3["start"], q3["end"], "1h"))
            return self._bars(q3, interval, range(expected - 24, expected))

        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp) / "cache.json"
            out = Path(tmp) / "out.json"
            cache.write_text(json.dumps({"levels": rows}), encoding="utf-8")
            payload, computed = build_symbol("ETHUSDT", cutoff, cache, out, fake_load)
            self.assertEqual(computed, [])
            self.assertFalse(any(row["id"] in expected_ids(q3) for row in payload["levels"]))
            written = json.loads(out.read_text(encoding="utf-8"))
            self.assertFalse(any(row["id"] in expected_ids(q3) for row in written["levels"]))

    def test_single_middle_gap_is_allowed_and_records_completeness(self):
        cutoff = datetime(2026, 10, 1, tzinfo=timezone.utc)
        q3 = next(spec for spec in target_periods(cutoff) if spec["label"] == "Q3")
        expected = int((q3["end"] - q3["start"]).total_seconds() // 3600)
        rows = self._cached_rows(cutoff, skip_label="Q3")

        def fake_load(_symbol, _market, interval, start, end):
            self.assertEqual((start, end, interval), (q3["start"], q3["end"], "1h"))
            return self._bars(q3, interval, {expected // 2})

        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp) / "cache.json"
            out = Path(tmp) / "out.json"
            cache.write_text(json.dumps({"levels": rows}), encoding="utf-8")
            payload, computed = build_symbol("ETHUSDT", cutoff, cache, out, fake_load)
            self.assertEqual(computed, ["Q3"])
            q3_rows = [row for row in payload["levels"] if row["id"] in expected_ids(q3)]
            self.assertEqual(len(q3_rows), 2)
            for row in q3_rows:
                self.assertTrue(row["complete"])
                self.assertEqual(row["bars"], expected - 1)
                self.assertEqual(row["expectedBars"], expected)

    def test_legacy_cache_rows_are_recomputed(self):
        cutoff = datetime(2026, 10, 1, tzinfo=timezone.utc)
        q3 = next(spec for spec in target_periods(cutoff) if spec["label"] == "Q3")
        rows = self._cached_rows(cutoff, legacy_label="Q3")
        calls = []

        def fake_load(_symbol, _market, interval, start, end):
            calls.append((interval, start, end))
            self.assertEqual((start, end, interval), (q3["start"], q3["end"], "1h"))
            return self._bars(q3, interval)

        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp) / "cache.json"
            out = Path(tmp) / "out.json"
            cache.write_text(json.dumps({"levels": rows}), encoding="utf-8")
            payload, computed = build_symbol("ETHUSDT", cutoff, cache, out, fake_load)
            self.assertEqual(computed, ["Q3"])
            self.assertEqual(len(calls), 1)
            q3_rows = [row for row in payload["levels"] if row["id"] in expected_ids(q3)]
            self.assertEqual(len(q3_rows), 2)
            self.assertTrue(all(row.get("complete") is True for row in q3_rows))


    def test_btc_year_levels_match_reference(self):
        refs = {
            2024: {"VWAP": (64960.2, 0.002)},
            2025: {"VAL": (87280.0, 0.003)},
        }
        for year, checks in refs.items():
            spec = {
                "kind": "year",
                "year": year,
                "label": "PY" if year == 2025 else str(year),
                "start": datetime(year, 1, 1, tzinfo=timezone.utc),
                "end": datetime(year + 1, 1, 1, tzinfo=timezone.utc),
            }
            vwap, vah, val, definition = year_levels("BTCUSDT", spec, load_range)
            self.assertEqual(definition, "Y / 4h VWAP±1σ (hlc3)")
            values = {"VWAP": vwap, "VAH": vah, "VAL": val}
            for side, (reference, tolerance) in checks.items():
                self.assertLessEqual(abs(values[side] - reference) / reference, tolerance)


if __name__ == "__main__":
    unittest.main()
