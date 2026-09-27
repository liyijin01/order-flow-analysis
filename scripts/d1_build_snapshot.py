#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from scripts.c4_1_golden import load_range  # noqa: E402

SYMBOLS=("BTCUSDT","ETHUSDT","SOLUSDT")
INTERVAL_MS={"30m":1_800_000,"1h":3_600_000,"4h":14_400_000,"1d":86_400_000,"1w":604_800_000}


def quarter_start(dt: datetime) -> datetime:
    month=((dt.month-1)//3)*3+1
    return datetime(dt.year,month,1,tzinfo=timezone.utc)


def previous_quarter_start(dt: datetime) -> datetime:
    q=quarter_start(dt)
    month=q.month-3
    year=q.year
    if month<=0:
        month+=12
        year-=1
    return datetime(year,month,1,tzinfo=timezone.utc)


def previous_month_start(dt: datetime) -> datetime:
    if dt.month==1:
        return datetime(dt.year-1,12,1,tzinfo=timezone.utc)
    return datetime(dt.year,dt.month-1,1,tzinfo=timezone.utc)


def pack(bar, interval: str):
    interval_ms=INTERVAL_MS[interval]
    t=bar.open_time
    quote=bar.volume*bar.typical
    return [
        t,
        f"{bar.open:.10f}",f"{bar.high:.10f}",f"{bar.low:.10f}",f"{bar.close:.10f}",
        f"{bar.volume:.10f}",t+interval_ms-1,f"{quote:.10f}",0,
        f"{bar.taker_buy_base:.10f}",f"{bar.taker_buy_base*bar.typical:.10f}","0",
    ]


def load_spec(symbol: str, interval: str, start: datetime, cutoff: datetime):
    bars=load_range(symbol,"um",interval,start,cutoff)
    if not bars:
        raise RuntimeError(f"no {symbol} {interval} bars for {start.isoformat()} -> {cutoff.isoformat()}")
    return symbol,interval,bars


def main(argv=None):
    ap=argparse.ArgumentParser()
    ap.add_argument("--output-dir",type=Path,required=True)
    ap.add_argument("--profile-dir",type=Path)
    ap.add_argument("--cutoff",help="exclusive UTC cutoff date, YYYY-MM-DD; defaults to today's UTC 00:00")
    args=ap.parse_args(argv)

    if args.cutoff:
        cutoff=datetime.fromisoformat(args.cutoff).replace(tzinfo=timezone.utc)
    else:
        now=datetime.now(timezone.utc)
        cutoff=datetime(now.year,now.month,now.day,tzinfo=timezone.utc)
    if cutoff.hour or cutoff.minute or cutoff.second:
        raise ValueError("cutoff must be a UTC day boundary")

    pq_start=previous_quarter_start(cutoff-timedelta(seconds=1))
    pm_start=previous_month_start(cutoff-timedelta(seconds=1))
    starts={
        "1h":pq_start,
        "30m":pm_start,
        "4h":cutoff-timedelta(hours=4*620),
        "1d":cutoff-timedelta(days=430),
        "1w":cutoff-timedelta(weeks=420),
    }
    jobs=[(s,i,starts[i]) for s in SYMBOLS for i in starts]
    series_by_symbol={s:{} for s in SYMBOLS}

    with ThreadPoolExecutor(max_workers=6) as pool:
        futures=[pool.submit(load_spec,s,i,start,cutoff) for s,i,start in jobs]
        for future in as_completed(futures):
            symbol,interval,bars=future.result()
            series_by_symbol[symbol][interval]=[pack(b,interval) for b in bars]
            print(f"{symbol}|{interval}: {len(bars)} real archived bars",flush=True)

    out_dir=args.output_dir
    out_dir.mkdir(parents=True,exist_ok=True)
    generated=datetime.now(timezone.utc).isoformat().replace("+00:00","Z")
    for symbol in SYMBOLS:
        profile=None
        errors={}
        if args.profile_dir:
            p=args.profile_dir/f"profiles-{symbol}.json"
            if p.exists():
                profile=json.loads(p.read_text(encoding="utf-8"))
            else:
                errors["profile"]=f"{p.name} missing"
        else:
            errors["profile"]="profile directory not supplied"
        payload={
            "schema":"analysis-snapshot-v1",
            "symbol":symbol,
            "generatedAt":generated,
            "cutoffUtc":cutoff.isoformat().replace("+00:00","Z"),
            "source":"Binance Vision USD-M archived klines + exact weekly aggTrades profile",
            "series":series_by_symbol[symbol],
            "profile":profile,
            "errors":errors,
        }
        path=out_dir/f"{symbol}.json"
        path.write_text(json.dumps(payload,separators=(",",":")),encoding="utf-8")
        print(f"wrote {path} ({path.stat().st_size} bytes)",flush=True)

    meta={
        "schema":"analysis-snapshot-index-v1",
        "generatedAt":generated,
        "cutoffUtc":cutoff.isoformat().replace("+00:00","Z"),
        "symbols":list(SYMBOLS),
    }
    (out_dir/"index.json").write_text(json.dumps(meta,separators=(",",":")),encoding="utf-8")
    return 0


if __name__=="__main__":
    raise SystemExit(main())
