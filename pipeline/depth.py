from __future__ import annotations

import csv
import gzip
import io
import json
import math
from datetime import datetime, timezone
from pathlib import Path


def normalize_epoch_ms(value) -> int:
    text = str(value).strip()
    try:
        number = float(text)
    except ValueError:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    n = abs(number)
    if n >= 1e14:
        return int(number / 1000)
    if n >= 1e11:
        return int(number)
    if n >= 1e9:
        return int(number * 1000)
    raise ValueError(f"unsupported timestamp: {value}")


def _has_header(row) -> bool:
    joined = ",".join(str(x).lower() for x in row)
    return any(key in joined for key in ("timestamp", "percentage", "depth", "notional", "open_time"))


def parse_kline_csv(text_stream):
    reader = csv.reader(text_stream)
    rows = []
    header = None
    for raw in reader:
        if not raw:
            continue
        if header is None and not rows and _has_header(raw):
            header = [x.strip().lower() for x in raw]
            continue
        if len(raw) < 11:
            continue
        open_ms = normalize_epoch_ms(raw[0])
        close_ms = normalize_epoch_ms(raw[6])
        rows.append({
            "time": open_ms // 1000,
            "openTime": open_ms,
            "closeTime": close_ms,
            "open": float(raw[1]),
            "high": float(raw[2]),
            "low": float(raw[3]),
            "close": float(raw[4]),
            "volume": float(raw[5]),
            "quoteVolume": float(raw[7]),
            "trades": int(float(raw[8])),
            "takerBuyBase": float(raw[9]),
            "takerBuyQuote": float(raw[10]),
        })
    return rows, header


def minute_close_lookup(bars):
    return {int(b["time"] // 60 * 60): float(b["close"]) for b in bars}


def _snapshot_payload(rows, required_levels, close, extra_pct):
    seen = set()
    sides = {"bid": {}, "ask": {}}
    full = {"bid": [], "ask": []}
    for pct, depth, notional in rows:
        if not all(math.isfinite(x) for x in (pct, depth, notional)):
            return None, "non-finite"
        if pct == 0 or depth < 0 or notional < 0:
            return None, "negative-or-zero"
        key = float(pct)
        if key in seen:
            return None, "duplicate-level"
        seen.add(key)
        side = "bid" if pct < 0 else "ask"
        full[side].append((abs(float(pct)), float(depth), float(notional)))
    for level in required_levels:
        if -float(level) not in seen or float(level) not in seen:
            return None, "missing-level"
    for side in ("bid", "ask"):
        prev_depth = prev_notional = -math.inf
        for pct, depth, notional in sorted(full[side]):
            if depth < prev_depth or notional < prev_notional:
                return None, "non-monotonic"
            prev_depth, prev_notional = depth, notional
            if depth > 0 and close and close > 0:
                avg = notional / depth
                deviation = abs(avg - close) / close * 100
                if deviation > pct + float(extra_pct):
                    return None, "average-price"
            sides[side][str(float(pct)).rstrip("0").rstrip(".")] = notional
    return sides, None


def parse_bookdepth_csv(text_stream, required_levels, one_minute_closes, extra_pct=0.5):
    reader = csv.reader(text_stream)
    header = None
    raw_rows = []
    for raw in reader:
        if not raw:
            continue
        if header is None and not raw_rows and _has_header(raw):
            header = [x.strip().lower() for x in raw]
            continue
        raw_rows.append(raw)
    if header:
        idx = {name: i for i, name in enumerate(header)}
        ti, pi, di, ni = idx["timestamp"], idx["percentage"], idx["depth"], idx["notional"]
    else:
        ti, pi, di, ni = 0, 1, 2, 3

    snapshots = []
    rejected = 0
    reasons = {}
    samples = []
    current_ts = None
    current = []
    previous_ts = None

    def finish(ts, rows):
        nonlocal rejected
        if ts is None:
            return
        if previous_ts is not None and ts <= previous_ts:
            rejected += 1
            reasons["time-order"] = reasons.get("time-order", 0) + 1
            if len(samples) < 5:
                samples.append({"time": ts, "reason": "time-order"})
            return
        minute = int((ts // 1000) // 60 * 60)
        close = one_minute_closes.get(minute)
        payload, reason = _snapshot_payload(rows, required_levels, close, extra_pct)
        if reason:
            rejected += 1
            reasons[reason] = reasons.get(reason, 0) + 1
            if len(samples) < 5:
                samples.append({"time": ts, "reason": reason})
            return
        snapshots.append({"time": ts // 1000, **payload})

    for raw in raw_rows:
        if len(raw) <= max(ti, pi, di, ni):
            continue
        ts = normalize_epoch_ms(raw[ti])
        row = (float(raw[pi]), float(raw[di]), float(raw[ni]))
        if current_ts is None:
            current_ts = ts
        if ts != current_ts:
            finish(current_ts, current)
            previous_ts = current_ts
            current_ts, current = ts, []
        current.append(row)
    finish(current_ts, current)
    total = len(snapshots) + rejected
    return {
        "snapshots": snapshots,
        "header": header,
        "totalSnapshots": total,
        "rejected": rejected,
        "reasons": reasons,
        "rejectedSamples": samples,
    }


def bucket_diff(snapshot, buckets):
    out = []
    for a, b in buckets:
        a = float(a); b = float(b)
        def value(side, boundary):
            if boundary == 0:
                return 0.0
            key = str(boundary).rstrip("0").rstrip(".")
            raw = snapshot.get(side, {}).get(key)
            return None if raw is None else float(raw)
        bid_b, bid_a = value("bid", b), value("bid", a)
        ask_b, ask_a = value("ask", b), value("ask", a)
        if None in (bid_b, bid_a, ask_b, ask_a):
            out.append(None)
            continue
        bid, ask = bid_b - bid_a, ask_b - ask_a
        out.append({"a": a, "b": b, "bid": bid, "ask": ask, "delta": bid - ask})
    return out


def asof_sample(bars, snapshots, interval_sec, buckets):
    src = sorted(snapshots, key=lambda x: x["time"])
    result = []
    j = 0
    last = None
    empty = used = 0
    tol = int(interval_sec)
    for bar in bars:
        close = int(bar["time"]) + tol
        while j < len(src) and int(src[j]["time"]) <= close:
            last = src[j]
            j += 1
        if last is None or close - int(last["time"]) > tol:
            result.append({"time": int(bar["time"]), "buckets": None})
            empty += 1
            continue
        values = bucket_diff(last, buckets)
        if any(v is None for v in values):
            result.append({"time": int(bar["time"]), "buckets": None})
            empty += 1
            continue
        result.append({"time": int(bar["time"]), "snapshotTime": int(last["time"]), "buckets": values})
        used += 1
    return {"rows": result, "emptyBars": empty, "snapshotsUsed": used}


def write_depth_gz(path: Path, payload: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"))


def load_depth_gz(path: Path) -> dict:
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)
