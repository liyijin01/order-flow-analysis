from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import re
import statistics
import urllib.error
import urllib.request
import zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = "https://data.binance.vision/data"
SYMBOLS = ("BTCUSDT", "ETHUSDT", "SOLUSDT")
UA = "order-flow-analysis-d6-probe/1.0"


def request_bytes(url: str, timeout: int = 120) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return response.read()


def request_text(url: str, timeout: int = 120) -> str:
    return request_bytes(url, timeout).decode("utf-8", errors="replace")


def verify_zip(url: str) -> bytes:
    checksum = request_text(url + ".CHECKSUM").strip().split()[0].lower()
    body = request_bytes(url, 180)
    actual = hashlib.sha256(body).hexdigest().lower()
    if actual != checksum:
        raise RuntimeError(f"checksum mismatch {url}: {actual} != {checksum}")
    return body


def csv_rows_from_zip(body: bytes):
    with zipfile.ZipFile(io.BytesIO(body)) as zf:
        names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
        if len(names) != 1:
            raise RuntimeError(f"unexpected zip members: {names}")
        raw = zf.read(names[0]).decode("utf-8-sig", errors="replace")
    return list(csv.reader(io.StringIO(raw)))


def has_header(row):
    if not row:
        return False
    joined = ",".join(row).lower()
    return any(x in joined for x in ("timestamp", "percentage", "depth", "notional", "open_time", "open time"))


def timestamp_unit(value):
    s = str(value).strip()
    try:
        n = abs(float(s))
    except ValueError:
        return "string"
    if n >= 1e14:
        return "us"
    if n >= 1e11:
        return "ms"
    if n >= 1e9:
        return "s"
    return "numeric-other"


def to_ms(value):
    s = str(value).strip()
    try:
        n = float(s)
    except ValueError:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return int(dt.timestamp() * 1000)
    if abs(n) >= 1e14:
        return int(n / 1000)
    if abs(n) >= 1e11:
        return int(n)
    if abs(n) >= 1e9:
        return int(n * 1000)
    raise ValueError(f"unsupported timestamp {value}")


def percentile(values, p):
    if not values:
        return None
    vals = sorted(values)
    k = (len(vals) - 1) * p
    lo = math.floor(k)
    hi = math.ceil(k)
    if lo == hi:
        return vals[lo]
    return vals[lo] * (hi - k) + vals[hi] * (k - lo)


def exists_url(url):
    try:
        request_bytes(url + ".CHECKSUM", 45)
        return True
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return False
        raise


def latest_available_dates(url_for_day, count=3, lookback=21):
    today = datetime.now(timezone.utc).date()
    found = []
    for delta in range(1, lookback + 1):
        ds = (today - timedelta(days=delta)).isoformat()
        if exists_url(url_for_day(ds)):
            found.append(ds)
            if len(found) >= count:
                break
    if len(found) < count:
        raise RuntimeError(f"fewer than {count} recent archived files")
    found.sort()
    return found


def earliest_available_date(url_for_day, latest_day):
    hi = date.fromisoformat(latest_day)
    step = 1
    lo = hi - timedelta(days=step)
    while exists_url(url_for_day(lo.isoformat())):
        hi = lo
        step *= 2
        lo = hi - timedelta(days=step)
        if lo.year < 2017:
            break
    left, right = lo, hi
    while (right - left).days > 1:
        mid = left + timedelta(days=(right - left).days // 2)
        if exists_url(url_for_day(mid.isoformat())):
            right = mid
        else:
            left = mid
    return right.isoformat()


def fetch_1m_close(symbol, day):
    url = f"{ROOT}/futures/um/daily/klines/{symbol}/1m/{symbol}-1m-{day}.zip"
    rows = csv_rows_from_zip(verify_zip(url))
    if rows and has_header(rows[0]):
        rows = rows[1:]
    out = []
    for r in rows:
        if len(r) < 5:
            continue
        out.append((to_ms(r[0]), float(r[4])))
    out.sort()
    return out


def nearest_close(closes, ts_ms):
    if not closes:
        return None
    minute = ts_ms - ts_ms % 60000
    last = None
    for t, close in closes:
        if t > minute:
            break
        last = close
    return last


def probe_bookdepth_symbol(symbol):
    directory = f"{ROOT}/futures/um/daily/bookDepth/{symbol}/"
    url_for_day = lambda ds: f"{directory}{symbol}-bookDepth-{ds}.zip"
    days = latest_available_dates(url_for_day, 3)
    earliest = earliest_available_date(url_for_day, days[-1])
    result = {
        "symbol": symbol,
        "earliestAvailableDate": earliest,
        "days": days,
        "files": [],
        "percentageValues": [],
        "intervalSeconds": {},
        "negativeSideInference": [],
        "cumulativeMonotonic": {},
    }
    all_pct = set()
    all_intervals = []
    monotonic_checks = 0
    monotonic_failures = 0
    side_votes = []
    for ds in days:
        url = f"{directory}{symbol}-bookDepth-{ds}.zip"
        rows = csv_rows_from_zip(verify_zip(url))
        if not rows:
            raise RuntimeError(f"{symbol} {ds}: empty bookDepth")
        header = rows[0] if has_header(rows[0]) else None
        data = rows[1:] if header else rows
        if header:
            names = [x.strip().lower() for x in header]
            def idx(name):
                return names.index(name)
            ti, pi, di, ni = idx("timestamp"), idx("percentage"), idx("depth"), idx("notional")
        else:
            # Binance bookDepth archive order observed historically.
            ti, pi, di, ni = 0, 1, 2, 3
        timestamps = []
        grouped = {}
        units = set()
        for r in data:
            if len(r) <= max(ti, pi, di, ni):
                continue
            ts = to_ms(r[ti]); units.add(timestamp_unit(r[ti]))
            pct = float(r[pi]); depth = float(r[di]); notional = float(r[ni])
            timestamps.append(ts); all_pct.add(pct)
            grouped.setdefault(ts, []).append((pct, depth, notional))
        unique_ts = sorted(set(timestamps))
        gaps = [(b-a)/1000 for a,b in zip(unique_ts, unique_ts[1:]) if b>a]
        all_intervals.extend(gaps)
        closes = fetch_1m_close(symbol, ds)
        votes = []
        for ts in unique_ts[: min(300, len(unique_ts))]:
            rows_at = grouped[ts]
            neg = [x for x in rows_at if x[0] < 0 and x[1] > 0]
            pos = [x for x in rows_at if x[0] > 0 and x[1] > 0]
            close = nearest_close(closes, ts)
            if close:
                for arr, sign in ((neg, "negative"), (pos, "positive")):
                    if not arr:
                        continue
                    pct, depth, notional = min(arr, key=lambda x: abs(x[0]))
                    avg = notional / depth if depth else None
                    if avg and math.isfinite(avg):
                        inferred = "bid" if avg < close else "ask"
                        votes.append({"sign": sign, "inferred": inferred, "avg": avg, "close": close, "pct": pct})
            by_abs = sorted(rows_at, key=lambda x: abs(x[0]))
            for sign in (-1, 1):
                side = [x for x in by_abs if math.copysign(1, x[0]) == sign]
                prev_d = prev_n = -math.inf
                ok = True
                for _, d, n in side:
                    if d < prev_d or n < prev_n:
                        ok = False
                        break
                    prev_d, prev_n = d, n
                if side:
                    monotonic_checks += 1
                    if not ok:
                        monotonic_failures += 1
        side_votes.extend(votes)
        result["files"].append({
            "date": ds,
            "header": header,
            "columnCount": len(rows[0]),
            "timestampUnits": sorted(units),
            "sampleTimestamp": data[0][ti] if data else None,
            "snapshots": len(unique_ts),
            "intervalSeconds": {
                "min": min(gaps) if gaps else None,
                "p50": percentile(gaps,.5),
                "p95": percentile(gaps,.95),
                "max": max(gaps) if gaps else None,
            },
        })
    result["percentageValues"] = sorted(all_pct)
    result["intervalSeconds"] = {
        "min": min(all_intervals) if all_intervals else None,
        "p50": percentile(all_intervals,.5),
        "p95": percentile(all_intervals,.95),
        "max": max(all_intervals) if all_intervals else None,
    }
    votes_summary = {}
    for v in side_votes:
        key = v["sign"] + "->" + v["inferred"]
        votes_summary[key] = votes_summary.get(key, 0) + 1
    result["negativeSideInference"] = votes_summary
    result["cumulativeMonotonic"] = {
        "checks": monotonic_checks,
        "failures": monotonic_failures,
        "pass": monotonic_failures == 0,
    }
    return result


def probe_kline_file(market, symbol, day):
    root = "spot" if market == "spot" else "futures/um"
    url = f"{ROOT}/{root}/daily/klines/{symbol}/15m/{symbol}-15m-{day}.zip"
    rows = csv_rows_from_zip(verify_zip(url))
    header = rows[0] if rows and has_header(rows[0]) else None
    data = rows[1:] if header else rows
    sample = next((r for r in data if len(r) >= 11), None)
    if not sample:
        raise RuntimeError(f"{market} {symbol} {day}: no kline row")
    return {
        "market": market,
        "symbol": symbol,
        "date": day,
        "header": header,
        "columnCount": len(sample),
        "timestampUnit": timestamp_unit(sample[0]),
        "quoteVolumeIndex7": float(sample[7]),
        "takerBuyQuoteIndex10": float(sample[10]),
        "sampleOpenTime": sample[0],
    }


def kline_probe_days(market, symbol):
    root = "spot" if market == "spot" else "futures/um"
    directory = f"{ROOT}/{root}/daily/klines/{symbol}/15m/"
    return latest_available_dates(lambda ds: f"{directory}{symbol}-15m-{ds}.zip", 3)



def diagnose_bookdepth_day(symbol, ds):
    url = f"{ROOT}/futures/um/daily/bookDepth/{symbol}/{symbol}-bookDepth-{ds}.zip"
    rows = csv_rows_from_zip(verify_zip(url))
    header = rows[0] if rows and has_header(rows[0]) else None
    data = rows[1:] if header else rows
    if header:
        names = [x.strip().lower() for x in header]
        ti, pi, di, ni = names.index("timestamp"), names.index("percentage"), names.index("depth"), names.index("notional")
    else:
        ti, pi, di, ni = 0, 1, 2, 3
    grouped = {}
    for r in data:
        if len(r) <= max(ti, pi, di, ni):
            continue
        ts = to_ms(r[ti])
        grouped.setdefault(ts, []).append((float(r[pi]), float(r[di]), float(r[ni])))
    closes = fetch_1m_close(symbol, ds)
    keys = sorted(grouped)
    picks = [keys[i] for i in sorted(set([0, len(keys)//4, len(keys)//2, (len(keys)*3)//4, len(keys)-1]))]
    out = []
    for ts in picks:
        close = nearest_close(closes, ts)
        levels = []
        for pct, depth, notional in sorted(grouped[ts], key=lambda x: x[0]):
            avg = notional/depth if depth else None
            dev = abs(avg-close)/close*100 if avg and close else None
            levels.append({"pct":pct,"depth":depth,"notional":notional,"avg":avg,"close":close,"devPct":dev,"limitPct":abs(pct)+0.5})
        out.append({"time":datetime.fromtimestamp(ts/1000,tz=timezone.utc).isoformat(),"levels":levels})
    return out

def main():
    out = {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00","Z"),
        "bookDepth": [],
        "klines": [],
    }
    for symbol in SYMBOLS:
        print("probing bookDepth", symbol, flush=True)
        out["bookDepth"].append(probe_bookdepth_symbol(symbol))
    for market in ("spot", "um"):
        for symbol in SYMBOLS:
            days = kline_probe_days(market, symbol)
            for ds in days:
                print("probing kline", market, symbol, ds, flush=True)
                out["klines"].append(probe_kline_file(market, symbol, ds))
    out["diagnostics"] = {
        "BTCUSDT-2026-09-07": diagnose_bookdepth_day("BTCUSDT","2026-09-07"),
        "BTCUSDT-2026-09-10": diagnose_bookdepth_day("BTCUSDT","2026-09-10"),
    }
    Path("d6-probe.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    lines = ["# D6 data probe", ""]
    for b in out["bookDepth"]:
        lines += [
            f"## {b['symbol']} bookDepth",
            f"- earliest: {b['earliestAvailableDate']}",
            f"- days: {', '.join(b['days'])}",
            f"- percentages: {b['percentageValues']}",
            f"- interval seconds: {b['intervalSeconds']}",
            f"- sign inference: {b['negativeSideInference']}",
            f"- cumulative monotonic: {b['cumulativeMonotonic']}",
        ]
        for f in b["files"]:
            lines.append(f"- {f['date']}: header={f['header']} units={f['timestampUnits']} sample={f['sampleTimestamp']} snapshots={f['snapshots']} interval={f['intervalSeconds']}")
        lines.append("")
    lines.append("## 15m kline files")
    for k in out["klines"]:
        lines.append(f"- {k['market']} {k['symbol']} {k['date']}: header={k['header']} timestamp={k['timestampUnit']} cols={k['columnCount']} index7={k['quoteVolumeIndex7']} index10={k['takerBuyQuoteIndex10']}")
    Path("d6-probe.md").write_text("\n".join(lines)+"\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
