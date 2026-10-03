#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline.tpo import value_area
from scripts.c4_1_golden import load_range, weighted_stats

SYMBOLS = ("BTCUSDT", "ETHUSDT", "SOLUSDT")
TICK_SIZE = {"BTCUSDT": 0.1, "ETHUSDT": 0.01, "SOLUSDT": 0.001}
MONTH_LABELS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
INTERVAL_MS = {"30m": 30 * 60 * 1000, "1h": 60 * 60 * 1000, "4h": 4 * 60 * 60 * 1000}


def iso_z(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def quarter_bounds(year: int, quarter: int):
    start_month = (quarter - 1) * 3 + 1
    start = datetime(year, start_month, 1, tzinfo=timezone.utc)
    if quarter == 4:
        end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(year, start_month + 3, 1, tzinfo=timezone.utc)
    return start, end


def month_bounds(year: int, month: int):
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    end = datetime(year + (month == 12), 1 if month == 12 else month + 1, 1, tzinfo=timezone.utc)
    return start, end


def target_periods(cutoff: datetime):
    if cutoff.tzinfo is None:
        raise ValueError("UTC-aware cutoff required")
    current_q = (cutoff.month - 1) // 3 + 1
    specs = []
    for q in range(1, current_q):
        start, end = quarter_bounds(cutoff.year, q)
        if end <= cutoff:
            specs.append({"kind": "quarter", "year": cutoff.year, "quarter": q, "start": start, "end": end, "label": f"Q{q}"})
    py = cutoff.year - 1
    for q in range(1, 5):
        start, end = quarter_bounds(py, q)
        specs.append({"kind": "py-quarter", "year": py, "quarter": q, "start": start, "end": end, "label": f"PY Q{q}"})
    for month in range(1, 13):
        start, end = month_bounds(py, month)
        specs.append({"kind": "py-month", "year": py, "month": month, "start": start, "end": end, "label": f"PY {MONTH_LABELS[month - 1]}"})
    for year in (cutoff.year - 1, cutoff.year - 2):
        start = datetime(year, 1, 1, tzinfo=timezone.utc)
        end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
        specs.append({
            "kind": "year", "year": year, "start": start, "end": end,
            "label": "PY" if year == cutoff.year - 1 else str(year),
        })
    return specs


def level_stem(spec: dict) -> str:
    if spec["kind"] == "year":
        return f"year-{spec['year']}"
    return spec["label"].replace(" ", "-").lower()


def expected_ids(spec):
    stem = level_stem(spec)
    sides = ("vwap", "vah", "val") if spec["kind"] == "year" else ("vah", "val")
    return {f"{stem}-{side}" for side in sides}


def period_interval(spec: dict) -> str:
    if spec["kind"] in ("quarter", "py-quarter"):
        return "1h"
    return "4h" if spec["kind"] == "year" else "30m"


def period_completeness(bars, spec: dict, interval: str):
    step_ms = INTERVAL_MS[interval]
    start_ms = int(spec["start"].timestamp() * 1000)
    end_ms = int(spec["end"].timestamp() * 1000)
    expected = (end_ms - start_ms) // step_ms
    opens = sorted({
        int(bar.open_time)
        for bar in bars
        if start_ms <= int(bar.open_time) < end_ms
    })
    count = len(opens)
    missing = max(0, expected - count)
    last_ok = bool(opens) and opens[-1] == end_ms - step_ms
    complete = last_ok and expected > 0 and missing / expected <= 0.005
    return count, expected, complete


def quarter_levels(symbol: str, spec: dict, load_fn=None, bars=None):
    load_fn = load_fn or load_range
    bars = bars if bars is not None else load_fn(symbol, "um", "1h", spec["start"], spec["end"])
    vwap, vah, val = weighted_stats(bars, "weighted-pop")
    definition = "Q / 1h VWAP±1σ"
    return vwap, vah, val, definition


def year_levels(symbol: str, spec: dict, load_fn=None, bars=None):
    load_fn = load_fn or load_range
    bars = bars if bars is not None else load_fn(symbol, "um", "4h", spec["start"], spec["end"])
    vwap, vah, val = weighted_stats(bars, "weighted-pop")
    return vwap, vah, val, "Y / 4h VWAP±1σ (hlc3)"


def monthly_tpo_levels(symbol: str, spec: dict, load_fn=None, bars=None):
    load_fn = load_fn or load_range
    bars = bars if bars is not None else load_fn(symbol, "um", "30m", spec["start"], spec["end"])
    size = TICK_SIZE[symbol] * 100
    counts = defaultdict(int)
    for bar in bars:
        lo = math.floor(bar.low / size)
        hi = math.floor((bar.high - 1e-12) / size)
        for index in range(lo, hi + 1):
            counts[index] += 1
    rows = [(index * size, count) for index, count in sorted(counts.items())]
    va = value_area(rows, size, .70)
    if not va:
        raise RuntimeError(f"no TPO rows for {symbol} {spec['label']}")
    return va["vah"], va["val"], "M / 30m TPO 70% · 100 ticks/row · single-row expansion"


def make_level(spec: dict, side: str, price: float, definition: str):
    stem = level_stem(spec)
    return {
        "id": f"{stem}-{side.lower()}",
        "label": f"{spec['label']} {side}",
        "kind": spec["kind"],
        "side": side,
        "price": float(price),
        "periodStart": iso_z(spec["start"]),
        "periodEnd": iso_z(spec["end"]),
        "definition": definition,
    }


def load_cache(path: Path):
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return {
        str(row.get("id")): row
        for row in payload.get("levels", [])
        if row.get("id") and row.get("complete") is True
    }


def build_symbol(symbol: str, cutoff: datetime, cache_path: Path, output_path: Path, load_fn=None):
    load_fn = load_fn or load_range
    cached = load_cache(cache_path)
    specs = target_periods(cutoff)
    levels = dict(cached)
    computed = []
    for spec in specs:
        ids = expected_ids(spec)
        if ids.issubset(levels):
            continue
        interval = period_interval(spec)
        bars = load_fn(symbol, "um", interval, spec["start"], spec["end"])
        bar_count, expected_bars, complete = period_completeness(bars, spec, interval)
        if not complete:
            for level_id in ids:
                levels.pop(level_id, None)
            print(
                f"::warning::{symbol} {spec['label']} incomplete {interval} data: "
                f"{bar_count}/{expected_bars} bars; final bar "
                f"{'present' if bars and int(bars[-1].open_time) == int(spec['end'].timestamp() * 1000) - INTERVAL_MS[interval] else 'missing'}",
                flush=True,
            )
            continue
        if spec["kind"] in ("quarter", "py-quarter"):
            _vwap, vah, val, definition = quarter_levels(symbol, spec, load_fn, bars)
            values = (("VAH", vah), ("VAL", val))
        elif spec["kind"] == "year":
            vwap, vah, val, definition = year_levels(symbol, spec, load_fn, bars)
            values = (("VWAP", vwap), ("VAH", vah), ("VAL", val))
        else:
            vah, val, definition = monthly_tpo_levels(symbol, spec, load_fn, bars)
            values = (("VAH", vah), ("VAL", val))
        for side, price in values:
            row = make_level(spec, side, price, definition)
            row.update({"bars": bar_count, "expectedBars": expected_bars, "complete": True})
            levels[row["id"]] = row
        computed.append(spec["label"])

    expected = set()
    for spec in specs:
        ids = expected_ids(spec)
        expected.update(ids)
        if spec["kind"] == "year":
            for side in ("VWAP", "VAH", "VAL"):
                level_id = f"{level_stem(spec)}-{side.lower()}"
                if level_id in levels:
                    levels[level_id] = {
                        **levels[level_id],
                        "label": f"{spec['label']} {side}",
                        "kind": "year",
                        "side": side,
                        "periodStart": iso_z(spec["start"]),
                        "periodEnd": iso_z(spec["end"]),
                    }
    rows = [levels[k] for k in sorted(expected) if k in levels]

    generated = iso_z(datetime.now(timezone.utc))
    payload = {
        "schema": "analysis-key-levels-v1",
        "symbol": symbol,
        "generatedAt": generated,
        "cutoffUtc": iso_z(cutoff - timedelta(seconds=1)),
        "levels": rows,
    }
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    compact = json.dumps(payload, separators=(",", ":"))
    cache_path.write_text(compact, encoding="utf-8")
    output_path.write_text(compact, encoding="utf-8")
    return payload, computed


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache-dir", type=Path, required=True)
    ap.add_argument("--output-dir", type=Path, required=True)
    ap.add_argument("--cutoff", help="exclusive UTC cutoff YYYY-MM-DD; default today UTC 00:00")
    args = ap.parse_args(argv)

    cutoff = datetime.fromisoformat(args.cutoff).replace(tzinfo=timezone.utc) if args.cutoff else datetime.now(timezone.utc)
    cutoff = datetime(cutoff.year, cutoff.month, cutoff.day, tzinfo=timezone.utc)

    for symbol in SYMBOLS:
        payload, computed = build_symbol(
            symbol,
            cutoff,
            args.cache_dir / f"{symbol}.json",
            args.output_dir / f"{symbol}.json",
        )
        print(f"{symbol}: {len(payload['levels'])} levels; computed {len(computed)} periods: {', '.join(computed) if computed else 'cache hit'}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
