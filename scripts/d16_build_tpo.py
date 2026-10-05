#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))

from pipeline.tpo import value_area
from scripts.c4_1_golden import load_range
from scripts.d10_build_levels import SYMBOLS,TICK_SIZE,iso_z,month_bounds,period_completeness


def monthly_specs(cutoff: datetime, count: int = 12):
    if cutoff.tzinfo is None:
        raise ValueError("UTC-aware cutoff required")
    year,month=cutoff.year,cutoff.month
    out=[]
    for _ in range(count):
        month-=1
        if month==0:
            year-=1;month=12
        start,end=month_bounds(year,month)
        out.append({"year":year,"month":month,"label":f"{year:04d}-{month:02d}","start":start,"end":end})
    return list(reversed(out))


def week_start(dt: datetime) -> datetime:
    d=dt.astimezone(timezone.utc)
    return datetime(d.year,d.month,d.day,tzinfo=timezone.utc)-timedelta(days=d.weekday())


def weekly_specs(cutoff: datetime, count: int = 52):
    if cutoff.tzinfo is None:
        raise ValueError("UTC-aware cutoff required")
    current=week_start(cutoff)
    out=[]
    for i in range(count,0,-1):
        start=current-timedelta(days=7*i)
        end=start+timedelta(days=7)
        out.append({"label":start.date().isoformat(),"start":start,"end":end})
    return out


def single_print_ranges(rows, row_size: float, min_rows: int = 3):
    src=sorted([[float(r[0]),int(r[1])] for r in rows],key=lambda r:r[0])
    start=0;end=len(src)-1
    while start<=end and src[start][1]==1:
        start+=1
    while end>=start and src[end][1]==1:
        end-=1
    out=[];run=None
    for i in range(start,end+1):
        price,count=src[i]
        if count==1:
            if run is None:
                run=[price,price+row_size,1]
            else:
                run[1]=price+row_size;run[2]+=1
        elif run is not None:
            if run[2]>=min_rows:out.append([run[0],run[1]])
            run=None
    if run is not None and run[2]>=min_rows:out.append([run[0],run[1]])
    return out


def profile_from_bars(symbol: str, bars):
    row_size=TICK_SIZE[symbol]*100
    counts=defaultdict(int)
    high=-math.inf;low=math.inf
    for bar in bars:
        high=max(high,float(bar.high));low=min(low,float(bar.low))
        lo=math.floor(float(bar.low)/row_size)
        hi=math.floor((float(bar.high)-1e-12)/row_size)
        for index in range(lo,hi+1):
            counts[index]+=1
    rows=[[index*row_size,count] for index,count in sorted(counts.items())]
    va=value_area(rows,row_size,.70)
    if not va:
        raise RuntimeError(f"no TPO rows for {symbol}")
    return{
        "rowSize":row_size,
        "poc":va["poc"],"vah":va["vah"],"val":va["val"],
        "high":high,"low":low,"rows":rows,
        "singlePrints":single_print_ranges(rows,row_size,3),
    }


def read_cached(path: Path):
    if not path.exists():
        return None
    try:
        row=json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return row if row.get("complete") is True and isinstance(row.get("singlePrints"),list) else None


def build_period(symbol: str, spec, cache_path: Path, load_fn):
    cached=read_cached(cache_path)
    if cached:return cached,False
    bars=load_fn(symbol,"um","30m",spec["start"],spec["end"])
    bar_count,expected_bars,complete=period_completeness(bars,spec,"30m")
    if not complete:
        print(f"::warning::{symbol} {spec['label']} incomplete 30m data: {bar_count}/{expected_bars} bars",flush=True)
        return None,False
    p=profile_from_bars(symbol,bars)
    row={"start":iso_z(spec["start"]),"end":iso_z(spec["end"]),"complete":True,"bars":bar_count,"expectedBars":expected_bars,**p}
    cache_path.parent.mkdir(parents=True,exist_ok=True)
    cache_path.write_text(json.dumps(row,separators=(",",":")),encoding="utf-8")
    return row,True


def build_symbol(symbol: str, cutoff: datetime, cache_dir: Path, output_dir: Path, load_fn=None):
    load_fn=load_fn or load_range
    monthly=[];weekly=[];computed_monthly=[];computed_weekly=[]
    for spec in monthly_specs(cutoff):
        row,fresh=build_period(symbol,spec,cache_dir/"monthly"/f"{symbol}-{spec['label']}.json",load_fn)
        if row:monthly.append(row)
        if fresh:computed_monthly.append(spec["label"])
    for spec in weekly_specs(cutoff):
        row,fresh=build_period(symbol,spec,cache_dir/"weekly"/f"{symbol}-{spec['label']}.json",load_fn)
        if row:weekly.append(row)
        if fresh:computed_weekly.append(spec["label"])
    recent_start=max(0,len(weekly)-26);weekly_out=[]
    for i,row in enumerate(weekly[-52:]):
        item=dict(row)
        if i<max(0,len(weekly[-52:])-26):item.pop("rows",None)
        weekly_out.append(item)
    payload={
        "schema":"analysis-tpo-v2","symbol":symbol,"generatedAt":iso_z(datetime.now(timezone.utc)),
        "cutoffUtc":iso_z(cutoff),"monthly":monthly[-12:],"weekly":weekly_out,
    }
    output_dir.mkdir(parents=True,exist_ok=True)
    (output_dir/f"{symbol}.json").write_text(json.dumps(payload,separators=(",",":")),encoding="utf-8")
    return payload,computed_monthly+computed_weekly


def parse_cutoff(raw: str | None):
    if not raw:return datetime.now(timezone.utc)
    dt=datetime.fromisoformat(raw.replace("Z","+00:00"))
    return dt.astimezone(timezone.utc)


def main(argv=None):
    ap=argparse.ArgumentParser()
    ap.add_argument("--cache-dir",type=Path,required=True)
    ap.add_argument("--output-dir",type=Path,required=True)
    ap.add_argument("--cutoff")
    args=ap.parse_args(argv)
    cutoff=parse_cutoff(args.cutoff)
    for symbol in SYMBOLS:
        payload,computed=build_symbol(symbol,cutoff,args.cache_dir,args.output_dir)
        print(f"{symbol}: {len(payload['monthly'])} monthly + {len(payload['weekly'])} weekly TPO profiles; computed {', '.join(computed) if computed else 'cache hit'}",flush=True)


if __name__=="__main__":
    raise SystemExit(main())
