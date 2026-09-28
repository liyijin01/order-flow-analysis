from __future__ import annotations
import csv, io, math, zipfile, sys
from pathlib import Path
ROOT_PATH=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT_PATH))
from scripts.d6_probe import verify_zip, csv_rows_from_zip, has_header, to_ms, fetch_1m_close

ROOT="https://data.binance.vision/data"
symbol="ETHUSDT"
day="2026-09-07"

rows=csv_rows_from_zip(verify_zip(f"{ROOT}/futures/um/daily/bookDepth/{symbol}/{symbol}-bookDepth-{day}.zip"))
header=rows[0] if has_header(rows[0]) else None
data=rows[1:] if header else rows
names=[x.strip().lower() for x in header]
ti,pi,di,ni=[names.index(x) for x in ("timestamp","percentage","depth","notional")]
grouped={}
for r in data:
    ts=to_ms(r[ti]); grouped.setdefault(ts,[]).append((float(r[pi]),float(r[di]),float(r[ni])))
closes=fetch_1m_close(symbol,day)
close_by_open={t:c for t,c in closes}
times=sorted(grouped)
stats={}
samples=[]
for ts in times:
    minute=ts-ts%60000
    containing=close_by_open.get(minute)
    prev=close_by_open.get(minute-60000)
    for pct,depth,notional in grouped[ts]:
        if abs(pct) not in (1.0,2.0,5.0) or depth<=0: continue
        avg=notional/depth
        key=f"{pct:+g}"
        rec=stats.setdefault(key,{"n":0,"fail_containing":0,"fail_prev":0,"max_containing":0.0,"max_prev":0.0})
        rec["n"]+=1
        for label,close in (("containing",containing),("prev",prev)):
            if not close: continue
            dev=abs(avg-close)/close*100
            rec[f"max_{label}"]=max(rec[f"max_{label}"],dev)
            if dev>abs(pct)+0.5:
                rec[f"fail_{label}"]+=1
                if len(samples)<20:
                    samples.append({"ts":ts,"pct":pct,"depth":depth,"notional":notional,"avg":avg,"closeKind":label,"close":close,"devPct":dev,"threshold":abs(pct)+0.5})
print("header",header)
print("snapshots",len(times))
for k in sorted(stats,key=lambda x:float(x)):
    print(k,stats[k])
print("samples")
for x in samples: print(x)
