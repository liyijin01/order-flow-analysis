#!/usr/bin/env python3
"""D18 profile-definition diagnostics.

Downloads BTCUSDT USD-M 30m klines from Binance Vision and prints:
1) monthly 70% TPO vs approximate volume-profile comparisons;
2) Jan W4 lower-bound candidates;
3) first-touch penetration for two disputed extension levels.

This script is intentionally not part of CI.
"""
from __future__ import annotations

import csv
import io
import math
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime, timedelta, timezone

BASE = "https://data.binance.vision/data/futures/um/monthly/klines/BTCUSDT/30m"
ROW_SIZE = 10.0  # BTCUSDT tick 0.1 * 100 ticks/row
TARGETS = {
    "2025-11": {"VAH": 102048.0},
    "2026-01": {"VAH": 94304.0, "VAL": 87424.0, "POC": 89344.0},
    "2026-05": {"VAH": 81200.0, "VAL": 76376.0},
    "2026-08": {"VAH": 77984.0},
    "2026-09": {"VAH": 83808.0, "VAL": 74912.0, "POC": 77280.0},
}
UTC = timezone.utc


def month_key(dt: datetime) -> str:
    return f"{dt.year:04d}-{dt.month:02d}"


def next_month(key: str) -> str:
    year, month = map(int, key.split("-"))
    month += 1
    if month == 13:
        year += 1
        month = 1
    return f"{year:04d}-{month:02d}"


def iter_months(start: str, end: str):
    key = start
    while key <= end:
        yield key
        key = next_month(key)


def load_month(key: str):
    url = f"{BASE}/BTCUSDT-30m-{key}.zip"
    with urllib.request.urlopen(url, timeout=60) as response:
        payload = response.read()
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        names = [n for n in archive.namelist() if n.endswith(".csv")]
        if not names:
            raise RuntimeError(f"no CSV in {url}")
        raw = archive.read(names[0]).decode("utf-8")
    bars = []
    for row in csv.reader(io.StringIO(raw)):
        if not row or not row[0].isdigit():
            continue
        bars.append({
            "time": int(row[0]),
            "open": float(row[1]),
            "high": float(row[2]),
            "low": float(row[3]),
            "close": float(row[4]),
            "volume": float(row[5]),
        })
    if not bars:
        raise RuntimeError(f"no klines parsed from {url}")
    return bars


def profile_rows(bars, weighted: bool):
    bins = defaultdict(float)
    for bar in bars:
        lo = math.floor(bar["low"] / ROW_SIZE)
        hi = math.floor((bar["high"] - 1e-12) / ROW_SIZE)
        count = max(1, hi - lo + 1)
        add = bar["volume"] / count if weighted else 1.0
        for idx in range(lo, hi + 1):
            bins[idx] += add
    return sorted((idx * ROW_SIZE, value) for idx, value in bins.items())


def value_area(rows, pct=0.70):
    if not rows:
        return None
    total = sum(value for _, value in rows)
    midpoint = (rows[0][0] + rows[-1][0] + ROW_SIZE) / 2
    poc_index, best_count, best_distance = 0, -math.inf, math.inf
    for i, (bottom, value) in enumerate(rows):
        distance = abs(bottom + ROW_SIZE / 2 - midpoint)
        if value > best_count or (value == best_count and distance <= best_distance):
            poc_index, best_count, best_distance = i, value, distance
    lo = hi = poc_index
    included = rows[poc_index][1]
    target = total * pct
    while included < target and (lo > 0 or hi < len(rows) - 1):
        up = rows[hi + 1][1] if hi < len(rows) - 1 else -1
        down = rows[lo - 1][1] if lo > 0 else -1
        if up >= down and hi < len(rows) - 1:
            hi += 1
            included += rows[hi][1]
        elif lo > 0:
            lo -= 1
            included += rows[lo][1]
        else:
            hi += 1
            included += rows[hi][1]
    return {
        "POC": rows[poc_index][0] + ROW_SIZE / 2,
        "VAH": rows[hi][0] + ROW_SIZE,
        "VAL": rows[lo][0],
    }


def fmt_price(value):
    return f"{value:,.1f}"


def fmt_error(value):
    return f"{value:+.4f}%"


def print_table(headers, rows):
    widths = [len(h) for h in headers]
    text_rows = [[str(x) for x in row] for row in rows]
    for row in text_rows:
        for i, value in enumerate(row):
            widths[i] = max(widths[i], len(value))
    def line(row):
        return "| " + " | ".join(value.ljust(widths[i]) for i, value in enumerate(row)) + " |"
    print(line(headers))
    print("| " + " | ".join("-" * widths[i] for i in range(len(headers))) + " |")
    for row in text_rows:
        print(line(row))


def utc_ms(year, month, day, hour=0):
    return int(datetime(year, month, day, hour, tzinfo=UTC).timestamp() * 1000)


def subset(bars, start_ms, end_ms):
    return [bar for bar in bars if start_ms <= bar["time"] < end_ms]


def extrema(bars):
    return min(b["low"] for b in bars), max(b["high"] for b in bars)


def week_start_ms(ms):
    dt = datetime.fromtimestamp(ms / 1000, UTC)
    monday = (dt - timedelta(days=dt.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return int(monday.timestamp() * 1000)


def period_groups(bars, mode: str, origin_ms: int):
    groups = {}
    for bar in bars:
        dt = datetime.fromtimestamp(bar["time"] / 1000, UTC)
        if mode == "month":
            key = int(datetime(dt.year, dt.month, 1, tzinfo=UTC).timestamp() * 1000)
        else:
            key = week_start_ms(bar["time"])
        if key <= origin_ms:
            continue
        row = groups.setdefault(key, {"low": math.inf, "high": -math.inf})
        row["low"] = min(row["low"], bar["low"])
        row["high"] = max(row["high"], bar["high"])
    return sorted(groups.items())


def first_touch(bars, mode: str, origin_ms: int, price: float):
    for start, row in period_groups(bars, mode, origin_ms):
        if row["low"] <= price <= row["high"]:
            penetration = min(row["high"] - price, price - row["low"])
            return start, row["low"], row["high"], penetration, penetration / price * 100
    return None


def main():
    cache = {}
    def month(key):
        if key not in cache:
            cache[key] = load_month(key)
        return cache[key]

    print("## 1. Monthly value area: TPO vs distributed-volume profile")
    rows = []
    tpo_abs, volume_abs = [], []
    for key, references in TARGETS.items():
        bars = month(key)
        tpo = value_area(profile_rows(bars, weighted=False))
        volume = value_area(profile_rows(bars, weighted=True))
        for field, reference in references.items():
            tpo_error = (tpo[field] - reference) / reference * 100
            volume_error = (volume[field] - reference) / reference * 100
            tpo_abs.append(abs(tpo_error))
            volume_abs.append(abs(volume_error))
            rows.append([
                key, field, fmt_price(reference), fmt_price(tpo[field]), fmt_error(tpo_error),
                fmt_price(volume[field]), fmt_error(volume_error),
            ])
    print_table(["Month", "Field", "Reference", "TPO", "TPO error", "Volume", "Volume error"], rows)
    print()
    print_table(
        ["Method", "Mean absolute error"],
        [["30m TPO", f"{sum(tpo_abs)/len(tpo_abs):.4f}%"], ["30m distributed volume", f"{sum(volume_abs)/len(volume_abs):.4f}%"]],
    )

    print("\n## 2. Jan W4 lower-bound candidates")
    jan_feb = month("2026-01") + month("2026-02")
    w4 = subset(jan_feb, utc_ms(2026, 1, 26), utc_ms(2026, 2, 2))
    w4_profile = value_area(profile_rows(w4, weighted=False))
    full_low, _ = extrema(w4)
    utc8 = subset(jan_feb, utc_ms(2026, 1, 25, 16), utc_ms(2026, 2, 1, 16))
    utc8_low, _ = extrema(utc8)
    no_sunday = [bar for bar in w4 if datetime.fromtimestamp(bar["time"]/1000, UTC).weekday() != 6]
    no_sunday_low, _ = extrema(no_sunday)
    previous = subset(jan_feb, utc_ms(2026, 1, 19), utc_ms(2026, 1, 26))
    previous_low, _ = extrema(previous)
    week_close = w4[-1]["close"]
    reference = 82060.0
    candidates = [
        ("full low", full_low),
        ("VAL", w4_profile["VAL"]),
        ("POC", w4_profile["POC"]),
        ("UTC+8 week low", utc8_low),
        ("excluding Sunday low", no_sunday_low),
        ("week close", week_close),
        ("previous week low", previous_low),
    ]
    candidates.sort(key=lambda item: abs(item[1] - reference))
    print_table(
        ["Candidate", "Value", "Difference vs 82,060", "Absolute difference"],
        [[name, fmt_price(value), fmt_price(value-reference), fmt_price(abs(value-reference))] for name, value in candidates],
    )

    print("\n## 3. Touch penetration")
    all_2026 = []
    for key in iter_months("2026-01", "2026-09"):
        all_2026.extend(month(key))
    tests = [
        ("2026-01 VAL", "month", utc_ms(2026, 1, 1), 87360.0),
        ("2026-08-17 week POC", "week", utc_ms(2026, 8, 17), 77305.0),
    ]
    touch_rows, penetrations = [], []
    for label, mode, origin, price in tests:
        result = first_touch(all_2026, mode, origin, price)
        if not result:
            touch_rows.append([label, "not touched", "", "", "", ""])
            continue
        start, low, high, usd, pct = result
        dt = datetime.fromtimestamp(start/1000, UTC)
        period = month_key(dt) if mode == "month" else dt.strftime("%Y-%m-%d")
        penetrations.append(pct)
        touch_rows.append([label, period, fmt_price(low), fmt_price(high), fmt_price(usd), f"{pct:.4f}%"])
    print_table(["Level", "First touching period", "Low", "High", "Penetration USD", "Penetration %"], touch_rows)
    change = len(penetrations) == 2 and all(value < 0.1 for value in penetrations)
    print(f"\nTouch rule change condition (both < 0.1%): {'YES' if change else 'NO'}")


if __name__ == "__main__":
    main()
