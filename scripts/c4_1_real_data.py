#!/usr/bin/env python3
from __future__ import annotations
import argparse, gzip, json, sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from scripts.c4_1_golden import load_range  # noqa: E402

SPECS={
    "1h": datetime(2025,1,1,tzinfo=timezone.utc),
    "30m": datetime(2026,4,1,tzinfo=timezone.utc),
    "2h": datetime(2025,1,1,tzinfo=timezone.utc),
}
END=datetime(2026,9,27,tzinfo=timezone.utc)
SYMBOLS=("BTCUSDT","ETHUSDT","SOLUSDT")

def pack(bar, interval_ms:int):
    t=bar.open_time
    typical_quote=bar.volume*bar.typical
    return [
        t,
        f"{bar.open:.10f}",f"{bar.high:.10f}",f"{bar.low:.10f}",f"{bar.close:.10f}",
        f"{bar.volume:.10f}",t+interval_ms-1,f"{typical_quote:.10f}",0,
        f"{bar.volume/2:.10f}",f"{typical_quote/2:.10f}","0"
    ]

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--out",type=Path,required=True)
    args=ap.parse_args()
    interval_ms={"1h":3600000,"30m":1800000,"2h":7200000}
    payload={"schema":"c4-1-real-klines-v1","end":END.isoformat(),"series":{}}
    jobs=[(symbol,interval,start) for symbol in SYMBOLS for interval,start in SPECS.items()]
    def build_one(spec):
        symbol,interval,start=spec
        bars=load_range(symbol,"um",interval,start,END)
        if not bars:
            raise RuntimeError(f"no real archive bars for {symbol} {interval}")
        return f"{symbol}|{interval}", interval, start, bars
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures=[pool.submit(build_one,spec) for spec in jobs]
        for future in as_completed(futures):
            key,interval,start,bars=future.result()
            payload["series"][key]=[pack(b,interval_ms[interval]) for b in bars]
            print(f"{key}: {len(bars)} real Binance Vision bars {start.date()} -> {END.date()}",flush=True)
    args.out.parent.mkdir(parents=True,exist_ok=True)
    with gzip.open(args.out,"wt",encoding="utf-8",compresslevel=6) as f:
        json.dump(payload,f,separators=(",",":"))
    print(f"wrote {args.out} ({args.out.stat().st_size} bytes)")
if __name__=="__main__":
    main()
