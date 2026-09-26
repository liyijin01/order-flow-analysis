from __future__ import annotations
import csv, hashlib, io, json, os, shutil, urllib.request, zipfile
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

SYMBOL=os.environ.get("SYMBOL","BTCUSDT")
BASE="https://data.binance.vision/data/futures/um/daily/aggTrades/{s}/{s}-aggTrades-{d}.zip"
ROOT=Path(__file__).resolve().parents[1]
CACHE=ROOT/".cache"/"binance"
OUT=ROOT/"weekly-vp.json"
CACHE.mkdir(parents=True,exist_ok=True)

def fetch_text(url:str)->str:
    req=urllib.request.Request(url,headers={"User-Agent":"order-flow-analysis/0.1"})
    with urllib.request.urlopen(req,timeout=90) as r:
        return r.read().decode("utf-8")

def download_day(day):
    ds=day.isoformat()
    url=BASE.format(s=SYMBOL,d=ds)
    zp=CACHE/f"{SYMBOL}-aggTrades-{ds}.zip"
    cp=CACHE/f"{SYMBOL}-aggTrades-{ds}.zip.CHECKSUM"
    try:
        if not cp.exists():
            cp.write_text(fetch_text(url+".CHECKSUM"),encoding="utf-8")
        expected=cp.read_text(encoding="utf-8").strip().split()[0].lower()
        if not zp.exists():
            print("download",url,flush=True)
            req=urllib.request.Request(url,headers={"User-Agent":"order-flow-analysis/0.1"})
            with urllib.request.urlopen(req,timeout=180) as r, open(zp,"wb") as f:
                shutil.copyfileobj(r,f,1024*1024)
        h=hashlib.sha256()
        with open(zp,"rb") as f:
            for chunk in iter(lambda:f.read(1024*1024),b""):
                h.update(chunk)
        got=h.hexdigest().lower()
        if got!=expected:
            zp.unlink(missing_ok=True)
            raise RuntimeError(f"checksum mismatch {ds}")
        return zp
    except Exception as e:
        print("skip",ds,type(e).__name__,e,flush=True)
        return None

def parse_day(day):
    zp=download_day(day)
    if zp is None:
        return None
    ladder=defaultdict(lambda:[0.0,0.0])
    with zipfile.ZipFile(zp) as z:
        names=[n for n in z.namelist() if n.lower().endswith(".csv")]
        if len(names)!=1:
            raise RuntimeError(f"unexpected zip members for {day}: {names}")
        with z.open(names[0]) as raw:
            text=io.TextIOWrapper(raw,encoding="utf-8",newline="")
            rd=csv.reader(text)
            first=True
            header=None
            for r in rd:
                if not r:
                    continue
                if first:
                    first=False
                    if not r[0].lstrip("-").isdigit():
                        header={v.strip().lower():i for i,v in enumerate(r)}
                        continue
                if header:
                    p=float(r[header["price"]])
                    q=float(r[header["quantity"]])
                    m=r[header["is_buyer_maker"]].strip().lower() in ("true","1")
                else:
                    p=float(r[1]); q=float(r[2]); m=r[6].strip().lower() in ("true","1")
                k=int(p)
                if m:
                    ladder[k][1]+=q
                else:
                    ladder[k][0]+=q
    return ladder

def merge(days):
    total=defaultdict(lambda:[0.0,0.0]); ok=[]
    for d in days:
        lad=parse_day(d)
        if lad is None:
            continue
        ok.append(d.isoformat())
        for k,(buy,sell) in lad.items():
            total[k][0]+=buy; total[k][1]+=sell
    rows=[[k,round(v[0],8),round(v[1],8)] for k,v in sorted(total.items())]
    return ok,rows

def main():
    now=datetime.now(timezone.utc)
    today=now.date()
    monday=today-timedelta(days=today.weekday())
    prev_start=monday-timedelta(days=7)
    previous=[prev_start+timedelta(days=i) for i in range(7)]
    # Current day archive is not complete/published; use completed UTC days only.
    current=[monday+timedelta(days=i) for i in range(max(0,(today-monday).days))]
    pd,pr=merge(previous)
    cd,cr=merge(current)
    data={
        "schema":"binance-vision-weekly-vp-v1",
        "symbol":SYMBOL,
        "generatedAt":now.isoformat().replace("+00:00","Z"),
        "priceBin":"1 USDT",
        "previous":{
            "label":f"{prev_start.isoformat()} to {(monday-timedelta(days=1)).isoformat()}",
            "days":pd,"rows":pr
        },
        "current":{
            "label":f"{monday.isoformat()} to completed archived UTC days before {today.isoformat()}",
            "days":cd,"rows":cr
        }
    }
    OUT.write_text(json.dumps(data,separators=(",",":")),encoding="utf-8")
    print("wrote",OUT,"previous_days",len(pd),"current_days",len(cd),"rows",len(pr),len(cr),flush=True)

if __name__=="__main__":
    main()
