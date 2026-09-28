from __future__ import annotations
import math, sys
from datetime import date, timedelta
from pathlib import Path
ROOT_PATH=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT_PATH))
from scripts.d6_probe import verify_zip, csv_rows_from_zip, has_header, to_ms, fetch_1m_close

ROOT="https://data.binance.vision/data"
symbol="ETHUSDT"
start=date(2026,9,7)
required={1.0,2.0,5.0}

grand_bad=grand_total=0
for i in range(21):
    day=(start+timedelta(days=i)).isoformat()
    rows=csv_rows_from_zip(verify_zip(f"{ROOT}/futures/um/daily/bookDepth/{symbol}/{symbol}-bookDepth-{day}.zip"))
    header=rows[0] if has_header(rows[0]) else None
    data=rows[1:] if header else rows
    names=[x.strip().lower() for x in header]
    ti,pi,di,ni=[names.index(x) for x in ("timestamp","percentage","depth","notional")]
    grouped={}
    for r in data:
        ts=to_ms(r[ti]); grouped.setdefault(ts,[]).append((float(r[pi]),float(r[di]),float(r[ni])))
    closes={t:c for t,c in fetch_1m_close(symbol,day)}
    bad=0;by_level={}
    for ts,items in grouped.items():
        close=closes.get(ts-ts%60000)
        reasons=[]
        for pct,depth,notional in items:
            if abs(pct) not in required: continue
            if not (math.isfinite(depth) and math.isfinite(notional)) or depth<0 or notional<0:
                reasons.append(("numeric",pct));continue
            if depth>0 and close:
                avg=notional/depth;dev=abs(avg-close)/close*100
                if dev>abs(pct)+0.5:
                    reasons.append(("avg",pct))
                    by_level[pct]=by_level.get(pct,0)+1
        if reasons: bad+=1
    total=len(grouped);grand_bad+=bad;grand_total+=total
    print(day, f"bad={bad}/{total} {bad/total*100:.3f}%", "levels", dict(sorted(by_level.items())), flush=True)
print("TOTAL",grand_bad,grand_total,f"{grand_bad/grand_total*100:.3f}%")
