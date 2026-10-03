#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from scripts.c4_1_golden import load_range  # noqa: E402
from scripts.d1_build_snapshot import aggregate_monthly, next_month_start_ms  # noqa: E402

DEFAULT_OUT=ROOT/"web/tests/fixtures/btcusdt-um-1M-2026-10-01.json"


def main(argv=None):
    ap=argparse.ArgumentParser()
    ap.add_argument("--output",type=Path,default=DEFAULT_OUT)
    args=ap.parse_args(argv)
    start=datetime(2019,9,1,tzinfo=timezone.utc)
    end=datetime(2026,10,2,tzinfo=timezone.utc)  # includes 2026-10-01 only
    daily=load_range("BTCUSDT","um","1d",start,end)
    monthly=aggregate_monthly(daily)
    bars=[]
    for b in monthly:
        d=datetime.fromtimestamp(b.open_time/1000,tz=timezone.utc)
        month=f"{d.year:04d}-{d.month:02d}"
        bars.append({
            "month":month,"time":b.open_time//1000,"openTime":b.open_time,
            "closeTime":next_month_start_ms(b.open_time)-1,
            "open":b.open,"high":b.high,"low":b.low,"close":b.close,
            "volume":b.volume,"takerBuyBase":b.taker_buy_base,
            "complete":next_month_start_ms(b.open_time)<=int(datetime(2026,10,1,tzinfo=timezone.utc).timestamp()*1000),
        })
    payload={
        "schema":"d15-monthly-fixture-v1","symbol":"BTCUSDT","market":"USD-M",
        "source":"Binance Vision USD-M daily klines aggregated by UTC natural month",
        "start":"2019-09-01T00:00:00Z","asOfUtc":"2026-10-02T00:00:00Z","partialMonth":"2026-10","bars":bars,
    }
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(payload,indent=2)+"\n",encoding="utf-8")
    print(f"wrote {args.output} ({len(bars)} monthly bars)")


if __name__=="__main__":
    raise SystemExit(main())
