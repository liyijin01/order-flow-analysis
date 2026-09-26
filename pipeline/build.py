from __future__ import annotations

import argparse
import json
import sys
import tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from pipeline.ladder import load_ladder_gz, parse_day_zip, write_ladder_gz
from pipeline.profiles import build_period
from pipeline.vision import download_verified_day

SOURCE = "data.binance.vision futures/um daily aggTrades"
ROOT = Path(__file__).resolve().parents[1]


def load_config(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def period_days(today: date):
    monday = today - timedelta(days=today.weekday())
    previous_start = monday - timedelta(days=7)
    previous = [previous_start + timedelta(days=i) for i in range(7)]
    current = [monday + timedelta(days=i) for i in range(max(0, (today - monday).days))]
    return monday, previous_start, previous, current


def ensure_day(symbol: str, cfg: dict, day: date, data_dir: Path, temp_dir: Path):
    path = data_dir / "ladders" / symbol / f"{day.isoformat()}.json.gz"
    if path.exists():
        return "existing", load_ladder_gz(path), None
    result = download_verified_day(symbol, day, temp_dir)
    if result.status != "ok":
        return result.status, None, result.error
    try:
        ladder, trades = parse_day_zip(result.zip_path, cfg["ladderBin"])
        write_ladder_gz(
            path,
            symbol=symbol,
            date=day.isoformat(),
            bin_size=cfg["ladderBin"],
            source=SOURCE,
            zip_sha256=result.sha256,
            trades=trades,
            ladder=ladder,
        )
        return "created", load_ladder_gz(path), None
    finally:
        if result.zip_path:
            result.zip_path.unlink(missing_ok=True)


def build_all(config: dict, data_dir: Path, output_dir: Path, today: date):
    output_dir.mkdir(parents=True, exist_ok=True)
    monday, previous_start, previous, current = period_days(today)
    any_usable = False
    summary = {}
    with tempfile.TemporaryDirectory(prefix="order-flow-vision-") as tmp:
        temp_dir = Path(tmp)
        for symbol, cfg in config.items():
            daily = {}
            failed = []
            statuses = {}
            for day in previous + current:
                status, payload, error = ensure_day(symbol, cfg, day, data_dir, temp_dir)
                statuses[day.isoformat()] = status
                if payload:
                    daily[day.isoformat()] = payload
                    any_usable = True
                elif status == "failed":
                    failed.append(day.isoformat())
                    print(f"::warning::{symbol} {day.isoformat()} failed: {error}")
            previous_profile = build_period(
                f"{previous_start.isoformat()} to {(monday - timedelta(days=1)).isoformat()}",
                previous,
                daily,
                failed,
            )
            current_profile = build_period(
                f"{monday.isoformat()} to completed archived UTC days before {today.isoformat()}",
                current,
                daily,
                failed,
            )
            if not previous_profile["complete"]:
                print(f"::warning::{symbol} previous completed week is incomplete; missing: {', '.join(previous_profile['missingDays'])}")
            payload = {
                "schema": "profiles-v2",
                "symbol": symbol,
                "base": cfg["base"],
                "binSize": cfg["ladderBin"],
                "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "source": SOURCE,
                "statuses": statuses,
                "profiles": {"previous": previous_profile, "current": current_profile},
            }
            out = output_dir / f"profiles-{symbol}.json"
            out.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
            summary[symbol] = payload
    if not any_usable:
        raise RuntimeError("No usable Binance Vision ladder data is available for any configured symbol; refusing to publish empty profiles.")
    return summary


def parse_args(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=ROOT / "config" / "symbols.json")
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "_generated")
    parser.add_argument("--today", type=date.fromisoformat, default=datetime.now(timezone.utc).date())
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    config = load_config(args.config)
    try:
        build_all(config, args.data_dir, args.output_dir, args.today)
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
