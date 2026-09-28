import io
import unittest

from pipeline.depth import (
    asof_sample,
    bucket_diff,
    normalize_epoch_ms,
    parse_bookdepth_csv,
    parse_kline_csv,
)


LEVELS = [1, 2, 5]


def snapshot_rows(ts="2026-09-27 00:00:30"):
    rows = []
    for sign in (-1, 1):
        for pct, depth, notional in [
            (0.2, 1, 100),
            (1, 2, 200),
            (2, 3, 300),
            (3, 4, 400),
            (4, 5, 500),
            (5, 6, 600),
        ]:
            rows.append([ts, sign * pct, depth, notional])
    return rows


def csv_text(rows, header=True):
    lines = []
    if header:
        lines.append("timestamp,percentage,depth,notional")
    lines.extend(",".join(map(str, r)) for r in rows)
    return "\n".join(lines) + "\n"


class DepthTests(unittest.TestCase):
    def test_timestamp_ms_us_and_string(self):
        self.assertEqual(normalize_epoch_ms("1790467200000"), 1790467200000)
        self.assertEqual(normalize_epoch_ms("1790467200000000"), 1790467200000)
        self.assertEqual(normalize_epoch_ms("2026-09-27 00:00:00"), 1790467200000)

    def test_bookdepth_header_and_no_header(self):
        closes = {1790467200: 100}
        for header in (True, False):
            result = parse_bookdepth_csv(io.StringIO(csv_text(snapshot_rows(), header)), LEVELS, closes)
            self.assertEqual(result["rejected"], 0)
            self.assertEqual(len(result["snapshots"]), 1)
            self.assertEqual(result["snapshots"][0]["bid"]["5"], 600)
            self.assertEqual(result["snapshots"][0]["ask"]["5"], 600)

    def test_validation_rejects_duplicate_missing_nonmonotonic_negative_and_average_price(self):
        closes = {1790467200: 100}
        cases = {}

        rows = snapshot_rows(); rows.append(rows[0][:]); cases["duplicate-level"] = rows
        rows = [r for r in snapshot_rows() if r[1] != -2]; cases["missing-level"] = rows
        rows = snapshot_rows()
        for r in rows:
            if r[1] == -2: r[2], r[3] = 1.5, 150
            if r[1] == -3: r[2], r[3] = 1.4, 140
        cases["non-monotonic"] = rows
        rows = snapshot_rows(); rows[0][2] = -1; cases["negative-or-zero"] = rows
        rows = snapshot_rows()
        for row in rows:
            if row[1] == -1:
                row[3] = 1000
                break
        cases["average-price"] = rows

        for expected, rows in cases.items():
            with self.subTest(expected=expected):
                result = parse_bookdepth_csv(io.StringIO(csv_text(rows)), LEVELS, closes)
                self.assertEqual(result["rejected"], 1)
                self.assertEqual(result["reasons"].get(expected), 1)

    def test_time_order_rejects_second_snapshot(self):
        closes = {1790467200: 100}
        rows = snapshot_rows("2026-09-27 00:00:30") + snapshot_rows("2026-09-27 00:00:20")
        result = parse_bookdepth_csv(io.StringIO(csv_text(rows)), LEVELS, closes)
        self.assertEqual(result["rejected"], 1)
        self.assertEqual(result["reasons"].get("time-order"), 1)

    def test_unused_source_level_average_mismatch_does_not_reject(self):
        closes = {1790467200: 100}
        rows = snapshot_rows()
        for row in rows:
            if abs(float(row[1])) == 0.2:
                row[3] = row[2] * 80
        result = parse_bookdepth_csv(io.StringIO(csv_text(rows)), LEVELS, closes)
        self.assertEqual(result["rejected"], 0)
        self.assertEqual(len(result["snapshots"]), 1)

    def test_bucket_diff(self):
        snap = {"bid": {"1": 100, "2": 240, "5": 600}, "ask": {"1": 80, "2": 190, "5": 500}}
        out = bucket_diff(snap, [[0,1],[1,2],[2,5]])
        self.assertEqual(out[0], {"a":0.0,"b":1.0,"bid":100.0,"ask":80.0,"delta":20.0})
        self.assertEqual(out[1]["delta"], 30.0)
        self.assertEqual(out[2]["delta"], 50.0)

    def test_asof_sampling_respects_one_bar_tolerance(self):
        bars = [{"time":0},{"time":900},{"time":1800}]
        snaps = [
            {"time":850,"bid":{"1":100,"2":200,"5":500},"ask":{"1":90,"2":180,"5":450}},
            {"time":1750,"bid":{"1":110,"2":220,"5":520},"ask":{"1":95,"2":190,"5":460}},
        ]
        out = asof_sample(bars, snaps, 900, [[0,1],[1,2],[2,5]])
        self.assertIsNotNone(out["rows"][0]["buckets"])
        self.assertIsNotNone(out["rows"][1]["buckets"])
        self.assertIsNone(out["rows"][2]["buckets"])
        self.assertEqual(out["emptyBars"], 1)

    def test_spot_kline_microseconds_and_quote_fields(self):
        text = "1790467200000000,100,101,99,100.5,12,1790468099999999,1206,9,7,704,0\n"
        bars, header = parse_kline_csv(io.StringIO(text))
        self.assertIsNone(header)
        self.assertEqual(bars[0]["time"], 1790467200)
        self.assertEqual(bars[0]["quoteVolume"], 1206)
        self.assertEqual(bars[0]["takerBuyQuote"], 704)


if __name__ == "__main__":
    unittest.main()
