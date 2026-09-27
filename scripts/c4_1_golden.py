#!/usr/bin/env python3
from __future__ import annotations

import csv
import io
import math
import sys
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache

BASE = "https://data.binance.vision/data"


@dataclass(frozen=True)
class Bar:
    open_time: int
    open: float
    high: float
    low: float
    close: float
    volume: float

    @property
    def typical(self) -> float:
        return (self.high + self.low + self.close) / 3.0


def venue_path(market: str) -> str:
    if market == "um":
        return "futures/um"
    if market == "spot":
        return "spot"
    raise ValueError(market)


def fetch_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "order-flow-analysis-c4.1"})
    with urllib.request.urlopen(req, timeout=45) as r:
        return r.read()


def parse_kline_zip(payload: bytes) -> list[Bar]:
    out: list[Bar] = []
    with zipfile.ZipFile(io.BytesIO(payload)) as zf:
        names = [n for n in zf.namelist() if not n.endswith("/")]
        if not names:
            return out
        with zf.open(names[0]) as raw:
            text = io.TextIOWrapper(raw, encoding="utf-8")
            reader = csv.reader(text)
            for row in reader:
                if not row:
                    continue
                try:
                    open_time = int(row[0])
                    open_ = float(row[1])
                    high = float(row[2])
                    low = float(row[3])
                    close = float(row[4])
                    volume = float(row[5])
                except (ValueError, IndexError):
                    continue
                # Binance Vision archives may use microseconds in some newer datasets.
                if open_time > 10_000_000_000_000:
                    open_time //= 1000
                out.append(Bar(open_time, open_, high, low, close, volume))
    return out


@lru_cache(maxsize=256)
def load_month(symbol: str, market: str, interval: str, year: int, month: int) -> tuple[Bar, ...]:
    ym = f"{year:04d}-{month:02d}"
    root = venue_path(market)
    url = f"{BASE}/{root}/monthly/klines/{symbol}/{interval}/{symbol}-{interval}-{ym}.zip"
    try:
        return tuple(parse_kline_zip(fetch_bytes(url)))
    except urllib.error.HTTPError as exc:
        if exc.code != 404:
            raise
        return ()


@lru_cache(maxsize=1024)
def load_day(symbol: str, market: str, interval: str, day: date) -> tuple[Bar, ...]:
    ds = day.isoformat()
    root = venue_path(market)
    url = f"{BASE}/{root}/daily/klines/{symbol}/{interval}/{symbol}-{interval}-{ds}.zip"
    try:
        return tuple(parse_kline_zip(fetch_bytes(url)))
    except urllib.error.HTTPError as exc:
        if exc.code != 404:
            raise
        return ()


def month_iter(start: datetime, end: datetime):
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        yield y, m
        m += 1
        if m == 13:
            y += 1
            m = 1


def load_range(symbol: str, market: str, interval: str, start: datetime, end: datetime) -> list[Bar]:
    if start.tzinfo is None or end.tzinfo is None:
        raise ValueError("UTC-aware datetimes required")
    bars: dict[int, Bar] = {}
    for y, m in month_iter(start, end):
        monthly = load_month(symbol, market, interval, y, m)
        if monthly:
            for b in monthly:
                bars[b.open_time] = b
            continue
        first = date(y, m, 1)
        next_month = date(y + (m == 12), 1 if m == 12 else m + 1, 1)
        d = first
        while d < next_month:
            for b in load_day(symbol, market, interval, d):
                bars[b.open_time] = b
            d += timedelta(days=1)
    lo = int(start.timestamp() * 1000)
    hi = int(end.timestamp() * 1000)
    return [bars[k] for k in sorted(bars) if lo <= k < hi]


def weighted_stats(bars: list[Bar], sigma_mode: str = "weighted-pop") -> tuple[float, float, float]:
    if not bars:
        raise ValueError("no bars")
    sum_v = sum(max(0.0, b.volume) for b in bars)
    if sum_v <= 0:
        raise ValueError("zero volume")
    vwap = sum(b.typical * max(0.0, b.volume) for b in bars) / sum_v

    if sigma_mode == "weighted-pop":
        variance = sum(max(0.0, b.volume) * (b.typical - vwap) ** 2 for b in bars) / sum_v
    elif sigma_mode == "weighted-sample":
        denom = max(1.0, sum_v - 1.0)
        variance = sum(max(0.0, b.volume) * (b.typical - vwap) ** 2 for b in bars) / denom
    elif sigma_mode == "unweighted-pop":
        variance = sum((b.typical - vwap) ** 2 for b in bars) / len(bars)
    elif sigma_mode == "unweighted-sample":
        denom = max(1, len(bars) - 1)
        variance = sum((b.typical - vwap) ** 2 for b in bars) / denom
    else:
        raise ValueError(sigma_mode)
    sigma = math.sqrt(max(0.0, variance))
    return vwap, vwap + sigma, vwap - sigma


def rel_err(actual: float, expected: float) -> float:
    return abs(actual - expected) / abs(expected) if expected else abs(actual - expected)


CASES = [
    {
        "name": "ETHUSDT um 1h 2026Q2",
        "symbol": "ETHUSDT", "market": "um", "interval": "1h",
        "start": datetime(2026, 4, 1, tzinfo=timezone.utc),
        "end": datetime(2026, 7, 1, tzinfo=timezone.utc),
        "expected": (2008.09, 2295.37, 1720.81), "tol": 0.0005,
    },
    {
        "name": "SOLUSDT spot 1h 2026Q2",
        "symbol": "SOLUSDT", "market": "spot", "interval": "1h",
        "start": datetime(2026, 4, 1, tzinfo=timezone.utc),
        "end": datetime(2026, 7, 1, tzinfo=timezone.utc),
        "expected": (79.82, 88.62, 71.02), "tol": 0.0005,
    },
    {
        "name": "ETHBTC spot 4h 2026Q2",
        "symbol": "ETHBTC", "market": "spot", "interval": "4h",
        "start": datetime(2026, 4, 1, tzinfo=timezone.utc),
        "end": datetime(2026, 7, 1, tzinfo=timezone.utc),
        "expected": (0.02879, 0.03066, 0.02693), "tol": 0.0005,
    },
    {
        "name": "ETHUSDT um 1h 2026Q3 cutoff",
        "symbol": "ETHUSDT", "market": "um", "interval": "1h",
        "start": datetime(2026, 7, 1, tzinfo=timezone.utc),
        "end": datetime(2026, 9, 25, 17, 0, tzinfo=timezone.utc),
        "expected": (2155.17, 2492.75, 1817.60), "tol": 0.001,
    },
    {
        "name": "SOLUSDT spot 1h 2026Q3 cutoff",
        "symbol": "SOLUSDT", "market": "spot", "interval": "1h",
        "start": datetime(2026, 7, 1, tzinfo=timezone.utc),
        "end": datetime(2026, 9, 25, 18, 0, tzinfo=timezone.utc),
        "expected": (92.47, 106.79, 78.15), "tol": 0.001,
    },
    {
        "name": "ETHBTC spot 4h 2026Q3 cutoff",
        "symbol": "ETHBTC", "market": "spot", "interval": "4h",
        "start": datetime(2026, 7, 1, tzinfo=timezone.utc),
        "end": datetime(2026, 9, 25, 20, 0, tzinfo=timezone.utc),
        "expected": (0.03041, 0.03198, 0.02884), "tol": 0.001,
    },
]

EXTRA = [
    ("ETHUSDT Q1 VAH", "ETHUSDT", "um", "1h", datetime(2026,1,1,tzinfo=timezone.utc), datetime(2026,4,1,tzinfo=timezone.utc), 1, 2750.62),
    ("ETHUSDT PY Q4 VAL", "ETHUSDT", "um", "1h", datetime(2025,10,1,tzinfo=timezone.utc), datetime(2026,1,1,tzinfo=timezone.utc), 2, 2928.71),
    ("ETHUSDT PY Nov VAL", "ETHUSDT", "um", "1h", datetime(2025,11,1,tzinfo=timezone.utc), datetime(2025,12,1,tzinfo=timezone.utc), 2, 2705.89),
]


def run_case(case: dict) -> bool:
    bars = load_range(case["symbol"], case["market"], case["interval"], case["start"], case["end"])
    actual = weighted_stats(bars, "weighted-pop")
    errs = [rel_err(a, e) for a, e in zip(actual, case["expected"])]
    ok = bool(bars) and max(errs) <= case["tol"]
    print(f"GOLD {case['name']}: bars={len(bars)} actual={actual[0]:.8f},{actual[1]:.8f},{actual[2]:.8f} expected={case['expected']} max_rel={max(errs):.6%} {'PASS' if ok else 'FAIL'}")
    if not ok:
        print("  diagnostics (expectations are NOT changed):")
        intervals = []
        for interval in [case["interval"], "30m", "4h"]:
            if interval not in intervals:
                intervals.append(interval)
        for interval in intervals:
            alt_bars = load_range(case["symbol"], case["market"], interval, case["start"], case["end"])
            if not alt_bars:
                print(f"  {interval}: no data")
                continue
            for mode in ["weighted-pop", "weighted-sample", "unweighted-pop", "unweighted-sample"]:
                values = weighted_stats(alt_bars, mode)
                errors = [rel_err(a, e) for a, e in zip(values, case["expected"])]
                print(f"  {interval:>3} {mode:<17} -> {values[0]:.8f},{values[1]:.8f},{values[2]:.8f} max_rel={max(errors):.6%}")
    return ok


def main() -> int:
    all_ok = True
    for case in CASES:
        try:
            all_ok = run_case(case) and all_ok
        except Exception as exc:
            all_ok = False
            print(f"GOLD {case['name']}: ERROR {exc}", file=sys.stderr)

    print("EXTRA reference comparisons:")
    for name, symbol, market, interval, start, end, index, expected in EXTRA:
        try:
            bars = load_range(symbol, market, interval, start, end)
            values = weighted_stats(bars, "weighted-pop")
            actual = values[index]
            print(f"  {name}: actual={actual:.8f} reference={expected:.8f} rel={rel_err(actual, expected):.6%} bars={len(bars)}")
        except Exception as exc:
            print(f"  {name}: ERROR {exc}")
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
