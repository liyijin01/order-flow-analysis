#!/usr/bin/env python3
from __future__ import annotations

import argparse
import io
import json
import sys
import tempfile
import zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))

from pipeline.depth import load_depth_gz, minute_close_lookup, parse_bookdepth_csv, parse_kline_csv, sample_depth15m_day, write_depth_gz
from pipeline.vision import download_verified_url, fetch_text
from scripts.d1_build_snapshot import floor_utc_day

SYMBOLS=("BTCUSDT","ETHUSDT","SOLUSDT")
BASE="https://data.binance.vision/data"


def archive_url(kind,symbol,day,market="um",interval="15m"):
    ds=day.isoformat()
    if kind=="bookDepth":
        return f"{BASE}/futures/um/daily/bookDepth/{symbol}/{symbol}-bookDepth-{ds}.zip"
    root="spot" if market=="spot" else "futures/um"
    return f"{BASE}/{root}/daily/klines/{symbol}/{interval}/{symbol}-{interval}-{ds}.zip"


def archive_exists(url):
    status,_=fetch_text(url+".CHECKSUM",retries=1)
    return status=="ok"


def common_cutoff(target):
    day=target.date()-timedelta(days=1)
    for _ in range(14):
        ok=True
        for symbol in SYMBOLS:
            urls=[
                archive_url("bookDepth",symbol,day),
                archive_url("kline",symbol,day,"um","15m"),
                archive_url("kline",symbol,day,"spot","15m"),
                archive_url("kline",symbol,day,"um","1m"),
            ]
            if not all(archive_exists(u) for u in urls):
                ok=False;break
        if ok:return datetime(day.year,day.month,day.day,tzinfo=timezone.utc)+timedelta(days=1)
        day-=timedelta(days=1)
    raise RuntimeError("no common D6 archive cutoff within 14 days")


def csv_from_zip(path):
    with zipfile.ZipFile(path) as zf:
        names=[n for n in zf.namelist() if n.lower().endswith(".csv")]
        if len(names)!=1:raise RuntimeError(f"unexpected zip members: {names}")
        return io.StringIO(zf.read(names[0]).decode("utf-8-sig",errors="replace"))


def download_rows(url,temp_dir):
    name=url.rsplit("/",1)[-1]
    result=download_verified_url(url,temp_dir,name)
    if result.status!="ok":return result.status,None,result.error
    try:
        return "ok",csv_from_zip(result.zip_path),None
    finally:
        pass


def load_kline_day(symbol,day,market,interval,temp_dir):
    url=archive_url("kline",symbol,day,market,interval)
    result=download_verified_url(url,temp_dir,url.rsplit("/",1)[-1])
    if result.status!="ok":return result.status,[],result.error
    try:
        rows,header=parse_kline_csv(csv_from_zip(result.zip_path))
        return "ok",rows,None
    finally:
        result.zip_path.unlink(missing_ok=True)


def ensure_depth_day(symbol,day,data_dir,temp_dir,rules):
    path=data_dir/"depth15m"/symbol/f"{day.isoformat()}.json.gz"
    if path.exists():return "existing",load_depth_gz(path),None
    book_url=archive_url("bookDepth",symbol,day)
    result=download_verified_url(book_url,temp_dir,book_url.rsplit("/",1)[-1])
    if result.status!="ok":return result.status,None,result.error
    one_status,one_rows,one_error=load_kline_day(symbol,day,"um","1m",temp_dir)
    if one_status!="ok":
        result.zip_path.unlink(missing_ok=True)
        return one_status,None,one_error
    try:
        parsed=parse_bookdepth_csv(
            csv_from_zip(result.zip_path),
            rules["depthLevels"],
            minute_close_lookup(one_rows),
            rules["depthValidation"]["averagePriceExtraPct"],
        )
        total=int(parsed.get("totalSnapshots",0));rejected=int(parsed.get("rejected",0))
        ratio=(rejected/total*100) if total else 100
        quarantined=ratio>=float(rules["depthValidation"]["maxRejectedPct"])
        samples=sample_depth15m_day(day,parsed.get("snapshots",[]),rules["depthLevels"],quarantined)
        used=sum(1 for row in samples if row.get("snapshotTime") is not None)
        payload={
            "schema":"depth15m-day-v1","symbol":symbol,"date":day.isoformat(),
            "source":"Binance Vision USD-M bookDepth","levels":rules["depthLevels"],
            "totalSnapshots":total,"rejected":rejected,
            "reasons":parsed.get("reasons",{}),"rejectedSamples":parsed.get("rejectedSamples",[]),
            "quarantined":quarantined,"samples":samples,
            "samplesUsed":used,"emptySamples":len(samples)-used,
        }
        write_depth_gz(path,payload)
        return "created",payload,None
    finally:
        result.zip_path.unlink(missing_ok=True)


def pack_bar(b):
    return [b["openTime"],str(b["open"]),str(b["high"]),str(b["low"]),str(b["close"]),str(b["volume"]),b["closeTime"],str(b["quoteVolume"]),b["trades"],str(b["takerBuyBase"]),str(b["takerBuyQuote"]),"0"]


def main(argv=None):
    ap=argparse.ArgumentParser()
    ap.add_argument("--data-dir",type=Path,required=True)
    ap.add_argument("--output-dir",type=Path,required=True)
    ap.add_argument("--rules",type=Path,default=ROOT/"config"/"flow-rules.json")
    ap.add_argument("--cutoff",help="exclusive UTC YYYY-MM-DD target")
    args=ap.parse_args(argv)
    rules=json.loads(args.rules.read_text(encoding="utf-8"))
    target=datetime.fromisoformat(args.cutoff).replace(tzinfo=timezone.utc) if args.cutoff else floor_utc_day(datetime.now(timezone.utc))
    actual=common_cutoff(target)
    if target-actual>timedelta(days=2):
        raise RuntimeError(f"D6 archives too stale: target={target.isoformat()} actual={actual.isoformat()}")
    days=int(rules.get("depthDays",21))
    start=actual.date()-timedelta(days=days)
    dates=[start+timedelta(days=i) for i in range(days)]
    args.output_dir.mkdir(parents=True,exist_ok=True)
    generated=datetime.now(timezone.utc).isoformat().replace("+00:00","Z")
    cutoff=(actual-timedelta(seconds=1)).isoformat().replace("+00:00","Z")

    with tempfile.TemporaryDirectory(prefix="d6-flow-") as td:
        temp=Path(td)
        for symbol in SYMBOLS:
            perp=[];spot=[];depth=[];missing_depth=[];invalid_depth=[];missing_perp=[];missing_spot=[]
            rejected=total=0;raw_total=invalid_snapshots=0;sampled_used=sampled_empty=0;rejected_samples=[];invalid_samples=[];statuses={}
            max_rejected_pct=float(rules["depthValidation"]["maxRejectedPct"])
            for day in dates:
                ds=day.isoformat()
                st,payload,err=ensure_depth_day(symbol,day,args.data_dir,temp,rules)
                statuses[ds]=st
                if payload:
                    day_rejected=int(payload.get("rejected",0));day_total=int(payload.get("totalSnapshots",0))
                    raw_total+=day_total
                    day_ratio=(day_rejected/day_total*100) if day_total else 100
                    quarantined=bool(payload.get("quarantined",day_ratio>=max_rejected_pct))
                    if quarantined:
                        invalid_depth.append(ds);invalid_snapshots+=day_total
                        statuses[ds]=st+"-invalid"
                        invalid_samples.append({
                            "date":ds,"rejected":day_rejected,"total":day_total,
                            "ratioPct":round(day_ratio,6),"reasons":payload.get("reasons",{}),
                            "samples":payload.get("rejectedSamples",[])[:3],
                        })
                        print(f"::warning::{symbol} depth {ds} quarantined: {day_rejected}/{day_total} ({day_ratio:.3f}%) invalid snapshots")
                    else:
                        day_samples=payload.get("samples",[])
                        depth.extend(day_samples)
                        sampled_used+=int(payload.get("samplesUsed",sum(1 for row in day_samples if row.get("snapshotTime") is not None)))
                        sampled_empty+=int(payload.get("emptySamples",sum(1 for row in day_samples if row.get("snapshotTime") is None)))
                        rejected+=day_rejected;total+=day_total
                        rejected_samples.extend(payload.get("rejectedSamples",[])[:max(0,5-len(rejected_samples))])
                else:
                    missing_depth.append(ds);print(f"::warning::{symbol} depth {ds} {st}: {err}")
                st,rows,err=load_kline_day(symbol,day,"um","15m",temp)
                if rows:perp.extend(rows)
                else:missing_perp.append(ds);print(f"::warning::{symbol} perp 15m {ds} {st}: {err}")
                st,rows,err=load_kline_day(symbol,day,"spot","15m",temp)
                if rows:spot.extend(rows)
                else:missing_spot.append(ds);print(f"::warning::{symbol} spot 15m {ds} {st}: {err}")

            perp.sort(key=lambda x:x["time"]);spot.sort(key=lambda x:x["time"]);depth.sort(key=lambda x:x["time"])
            kpayload={
                "schema":"flow-snapshot-v1","symbol":symbol,"generatedAt":generated,"cutoffUtc":cutoff,
                "source":"Binance Vision spot + USD-M 15m klines",
                "perp15m":[pack_bar(x) for x in perp],"spot15m":[pack_bar(x) for x in spot],
                "missingPerpDays":missing_perp,"missingSpotDays":missing_spot,
            }
            dpayload={
                "schema":"flow-depth-v2","symbol":symbol,"generatedAt":generated,"cutoffUtc":cutoff,
                "source":"Binance USD-M bookDepth, validated and sampled at 15m bar close","levels":rules["depthLevels"],"bucketsUsed":rules["depthBuckets"],
                "samples":depth,"snapshotsUsed":sampled_used,"emptyBars":sampled_empty,
                "totalSnapshots":total,"snapshotsRejected":rejected,
                "rawSnapshots":raw_total,"invalidSnapshots":invalid_snapshots,
                "rejectedSamples":rejected_samples,"invalidDays":invalid_depth,"invalidSamples":invalid_samples,
                "missingDays":missing_depth,"statuses":statuses,
            }
            (args.output_dir/f"{symbol}.json").write_text(json.dumps(kpayload,separators=(",",":")),encoding="utf-8")
            (args.output_dir/f"depth-{symbol}.json").write_text(json.dumps(dpayload,separators=(",",":")),encoding="utf-8")
            ratio=(rejected/total*100) if total else 100
            print(
                f"{symbol}: perp={len(perp)} spot={len(spot)} depth15m={sampled_used}/{len(depth)} "
                f"rejected={rejected}/{total} ({ratio:.3f}%) invalidDays={len(invalid_depth)} "
                f"invalidSnapshots={invalid_snapshots}/{raw_total}",
                flush=True,
            )
            if invalid_samples:
                print("quarantined depth days:",json.dumps(invalid_samples,ensure_ascii=False),flush=True)
            if ratio>=max_rejected_pct:
                print("rejected samples:",json.dumps(rejected_samples,ensure_ascii=False),file=sys.stderr)
                return 2

    index={"schema":"flow-snapshot-index-v1","generatedAt":generated,"cutoffUtc":cutoff,"symbols":list(SYMBOLS),"bucketsUsed":rules["depthBuckets"]}
    (args.output_dir/"index.json").write_text(json.dumps(index,separators=(",",":")),encoding="utf-8")
    return 0


if __name__=="__main__":
    raise SystemExit(main())
