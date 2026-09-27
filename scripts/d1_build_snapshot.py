#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from scripts.c4_1_golden import Bar, load_range  # noqa: E402

SYMBOLS=("BTCUSDT","ETHUSDT","SOLUSDT")
INCEPTION={
    "BTCUSDT":datetime(2019,9,1,tzinfo=timezone.utc),
    "ETHUSDT":datetime(2019,11,1,tzinfo=timezone.utc),
    "SOLUSDT":datetime(2020,9,1,tzinfo=timezone.utc),
}
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


def pack(bar: Bar, interval: str):
    interval_ms=INTERVAL_MS[interval]
    t=bar.open_time
    quote=bar.volume*bar.typical
    return [
        t,
        f"{bar.open:.10f}",f"{bar.high:.10f}",f"{bar.low:.10f}",f"{bar.close:.10f}",
        f"{bar.volume:.10f}",t+interval_ms-1,f"{quote:.10f}",0,
        f"{bar.taker_buy_base:.10f}",f"{bar.taker_buy_base*bar.typical:.10f}","0",
    ]


def week_start_ms(open_time_ms: int) -> int:
    dt=datetime.fromtimestamp(open_time_ms/1000,tz=timezone.utc)
    monday=dt-timedelta(days=dt.weekday(),hours=dt.hour,minutes=dt.minute,seconds=dt.second,microseconds=dt.microsecond)
    return int(monday.timestamp()*1000)


def aggregate_weekly(daily_bars: list[Bar]) -> list[Bar]:
    groups: dict[int,list[Bar]]={}
    for bar in sorted(daily_bars,key=lambda b:b.open_time):
        groups.setdefault(week_start_ms(bar.open_time),[]).append(bar)
    out=[]
    for start,rows in sorted(groups.items()):
        rows=sorted(rows,key=lambda b:b.open_time)
        if len(rows)!=7:
            continue
        expected=[start+i*INTERVAL_MS["1d"] for i in range(7)]
        if [b.open_time for b in rows]!=expected:
            continue
        available_until=rows[-1].open_time+INTERVAL_MS["1d"]
        if available_until<start+INTERVAL_MS["1w"]:
            continue
        out.append(Bar(
            open_time=start,
            open=rows[0].open,
            high=max(b.high for b in rows),
            low=min(b.low for b in rows),
            close=rows[-1].close,
            volume=sum(b.volume for b in rows),
            taker_buy_base=sum(b.taker_buy_base for b in rows),
        ))
    return out


def available_exclusive(bars: list[Bar], interval: str) -> datetime:
    if not bars:
        raise RuntimeError(f"no {interval} bars")
    ms=bars[-1].open_time+INTERVAL_MS[interval]
    return datetime.fromtimestamp(ms/1000,tz=timezone.utc)


def crop_complete(bars: list[Bar], interval: str, cutoff: datetime) -> list[Bar]:
    cutoff_ms=int(cutoff.timestamp()*1000)
    step=INTERVAL_MS[interval]
    return [b for b in bars if b.open_time+step<=cutoff_ms]


def load_spec(symbol: str, interval: str, start: datetime, cutoff: datetime):
    bars=load_range(symbol,"um",interval,start,cutoff)
    if not bars:
        raise RuntimeError(f"no {symbol} {interval} bars for {start.isoformat()} -> {cutoff.isoformat()}")
    return symbol,interval,bars


def floor_utc_day(dt: datetime) -> datetime:
    return datetime(dt.year,dt.month,dt.day,tzinfo=timezone.utc)


def main(argv=None):
    ap=argparse.ArgumentParser()
    ap.add_argument("--output-dir",type=Path,required=True)
    ap.add_argument("--profile-dir",type=Path)
    ap.add_argument("--cutoff",help="exclusive target UTC cutoff date, YYYY-MM-DD; defaults to today's UTC 00:00")
    args=ap.parse_args(argv)

    if args.cutoff:
        target=datetime.fromisoformat(args.cutoff).replace(tzinfo=timezone.utc)
    else:
        now=datetime.now(timezone.utc)
        target=datetime(now.year,now.month,now.day,tzinfo=timezone.utc)
    if target.hour or target.minute or target.second:
        raise ValueError("cutoff must be a UTC day boundary")

    pq_start=previous_quarter_start(target-timedelta(seconds=1))
    pm_start=previous_month_start(target-timedelta(seconds=1))
    daily_start={s:max(INCEPTION[s],target-timedelta(weeks=420)) for s in SYMBOLS}
    starts={
        "1h":pq_start,
        "30m":pm_start,
        "4h":target-timedelta(hours=4*620),
    }

    raw={s:{} for s in SYMBOLS}
    jobs=[(s,i,starts[i]) for s in SYMBOLS for i in starts]
    jobs.extend((s,"1d",daily_start[s]) for s in SYMBOLS)

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures=[pool.submit(load_spec,s,i,start,target) for s,i,start in jobs]
        for future in as_completed(futures):
            symbol,interval,bars=future.result()
            raw[symbol][interval]=bars
            print(f"{symbol}|{interval}: {len(bars)} real archived bars",flush=True)

    avail=[]
    for symbol in SYMBOLS:
        for interval in ("30m","1h","4h","1d"):
            until=available_exclusive(raw[symbol][interval],interval)
            avail.append(until)
            print(f"{symbol}|{interval} available through {until.isoformat()}",flush=True)
    actual_exclusive=floor_utc_day(min(avail))
    if actual_exclusive>target:
        actual_exclusive=target
    if actual_exclusive<target:
        print(f"::warning::target cutoff {target.isoformat()} unavailable; using {actual_exclusive.isoformat()}",flush=True)
    if target-actual_exclusive>timedelta(days=2):
        print(f"ERROR: archived market data is more than 2 days stale: target={target.isoformat()} actual={actual_exclusive.isoformat()}",file=sys.stderr)
        return 2

    series_by_symbol={s:{} for s in SYMBOLS}
    for symbol in SYMBOLS:
        one=crop_complete(raw[symbol]["1h"],"1h",actual_exclusive)
        thirty=crop_complete(raw[symbol]["30m"],"30m",actual_exclusive)
        four=crop_complete(raw[symbol]["4h"],"4h",actual_exclusive)
        daily_all=crop_complete(raw[symbol]["1d"],"1d",actual_exclusive)
        weekly=aggregate_weekly(daily_all)
        series_by_symbol[symbol]["1h"]=[pack(b,"1h") for b in one]
        series_by_symbol[symbol]["30m"]=[pack(b,"30m") for b in thirty]
        series_by_symbol[symbol]["4h"]=[pack(b,"4h") for b in four[-620:]]
        series_by_symbol[symbol]["1d"]=[pack(b,"1d") for b in daily_all[-430:]]
        series_by_symbol[symbol]["1w"]=[pack(b,"1w") for b in weekly[-400:]]
        print(f"{symbol}|1w: {len(weekly[-400:])} weeks aggregated from 1d",flush=True)

    out_dir=args.output_dir
    out_dir.mkdir(parents=True,exist_ok=True)
    generated=datetime.now(timezone.utc).isoformat().replace("+00:00","Z")
    inclusive_cutoff=(actual_exclusive-timedelta(seconds=1)).isoformat().replace("+00:00","Z")
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
            "schema":"analysis-snapshot-v2",
            "symbol":symbol,
            "generatedAt":generated,
            "cutoffUtc":inclusive_cutoff,
            "targetCutoffUtc":target.isoformat().replace("+00:00","Z"),
            "source":"Binance Vision USD-M archived klines; 1w aggregated from complete 1d weeks; exact weekly aggTrades profile",
            "series":series_by_symbol[symbol],
            "profile":profile,
            "errors":errors,
        }
        path=out_dir/f"{symbol}.json"
        path.write_text(json.dumps(payload,separators=(",",":")),encoding="utf-8")
        print(f"wrote {path} ({path.stat().st_size} bytes)",flush=True)

    meta={
        "schema":"analysis-snapshot-index-v2",
        "generatedAt":generated,
        "cutoffUtc":inclusive_cutoff,
        "targetCutoffUtc":target.isoformat().replace("+00:00","Z"),
        "symbols":list(SYMBOLS),
    }
    (out_dir/"index.json").write_text(json.dumps(meta,separators=(",",":")),encoding="utf-8")
    return 0


if __name__=="__main__":
    raise SystemExit(main())
