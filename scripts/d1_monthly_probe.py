#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import sys
import tempfile
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))

from pipeline.ladder import parse_day_zip
from pipeline.vision import download_verified_day
from scripts.c4_1_golden import load_range, weighted_stats

SYMBOL="ETHUSDT"
START=datetime(2025,11,1,tzinfo=timezone.utc)
END=datetime(2025,12,1,tzinfo=timezone.utc)
REFERENCE=2705.89
BIN_SIZE=Decimal("0.1")
TPO_BIN=1.0


def value_area(rows,bin_size: float,pct: float=.70):
    rows=sorted((float(p),float(v)) for p,v in rows)
    if not rows:
        return None
    total=sum(v for _,v in rows)
    midpoint=(rows[0][0]+rows[-1][0]+bin_size)/2
    maxv=max(v for _,v in rows)
    candidates=[i for i,(_,v) in enumerate(rows) if v==maxv]
    poc=min(candidates,key=lambda i:abs((rows[i][0]+bin_size/2)-midpoint))
    lo=hi=poc
    acc=rows[poc][1]
    target=total*pct
    while acc<target and (lo>0 or hi<len(rows)-1):
        up=rows[hi+1][1] if hi<len(rows)-1 else -1
        dn=rows[lo-1][1] if lo>0 else -1
        if up>=dn and hi<len(rows)-1:
            hi+=1
            acc+=rows[hi][1]
        elif lo>0:
            lo-=1
            acc+=rows[lo][1]
        else:
            hi+=1
            acc+=rows[hi][1]
    return {
        "poc":rows[poc][0]+bin_size/2,
        "vah":rows[hi][0]+bin_size,
        "val":rows[lo][0],
        "included":acc,
        "total":total,
    }


def method_exact_vp():
    total=defaultdict(lambda:[Decimal("0"),Decimal("0")])
    day=date(2025,11,1)
    trades=0
    with tempfile.TemporaryDirectory(prefix="d1-monthly-vp-") as tmp:
        tmpdir=Path(tmp)
        while day<date(2025,12,1):
            result=download_verified_day(SYMBOL,day,tmpdir)
            if result.status!="ok" or not result.zip_path:
                raise RuntimeError(f"{day} aggTrades {result.status}: {result.error}")
            ladder,n=parse_day_zip(result.zip_path,str(BIN_SIZE))
            trades+=n
            for idx,(buy,sell) in ladder.items():
                total[int(idx)][0]+=buy
                total[int(idx)][1]+=sell
            result.zip_path.unlink(missing_ok=True)
            print(f"VP {day}: {n} aggTrades",flush=True)
            day+=timedelta(days=1)
    rows=[(float(Decimal(idx)*BIN_SIZE),float(v[0]+v[1])) for idx,v in sorted(total.items())]
    va=value_area(rows,float(BIN_SIZE))
    return {"value":va["val"],"poc":va["poc"],"vah":va["vah"],"trades":trades,"bins":len(rows)}


def method_tpo():
    bars=load_range(SYMBOL,"um","30m",START,END)
    counts=defaultdict(int)
    for b in bars:
        lo=math.floor(b.low/TPO_BIN)
        hi=math.floor((b.high-1e-12)/TPO_BIN)
        for i in range(lo,hi+1):
            counts[i]+=1
    rows=[(i*TPO_BIN,n) for i,n in sorted(counts.items())]
    va=value_area(rows,TPO_BIN)
    return {"value":va["val"],"poc":va["poc"],"vah":va["vah"],"bars":len(bars),"bins":len(rows)}


def method_vwap_2sigma():
    bars=load_range(SYMBOL,"um","1h",START,END)
    vwap,upper1,lower1=weighted_stats(bars,"weighted-pop")
    sigma=upper1-vwap
    return {"value":vwap-2*sigma,"vwap":vwap,"sigma":sigma,"bars":len(bars)}


def rel_pct(v):
    return abs(float(v)-REFERENCE)/REFERENCE*100


def main(argv=None):
    ap=argparse.ArgumentParser()
    ap.add_argument("--out",type=Path)
    args=ap.parse_args(argv)
    methods=[]
    for name,fn in [
        ("aggTrades volume profile 70% VAL",method_exact_vp),
        ("30m TPO 70% VAL",method_tpo),
        ("anchored VWAP -2sigma",method_vwap_2sigma),
    ]:
        try:
            detail=fn()
            value=float(detail["value"])
            methods.append({"name":name,"value":value,"relativeErrorPct":rel_pct(value),"detail":detail})
            print(f"{name}: {value:.8f}; reference {REFERENCE:.2f}; error {rel_pct(value):.6f}%",flush=True)
        except Exception as exc:
            methods.append({"name":name,"error":str(exc)})
            print(f"{name}: ERROR {exc}",flush=True)
    chosen=next((m["name"] for m in methods if "value" in m and m["relativeErrorPct"]<=0.3),None)
    payload={"schema":"d1-monthly-definition-probe-v1","reference":REFERENCE,"methods":methods,"chosen":chosen}
    print("RESULT "+json.dumps(payload,separators=(",",":")),flush=True)
    if args.out:
        args.out.parent.mkdir(parents=True,exist_ok=True)
        args.out.write_text(json.dumps(payload,indent=2),encoding="utf-8")
    return 0 if all("value" in m for m in methods) else 2


if __name__=="__main__":
    raise SystemExit(main())
