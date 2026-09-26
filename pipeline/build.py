from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pipeline.ladder import parse_day_zip
from pipeline.profiles import merge_days
from pipeline.vision import download_day

SYMBOL = os.environ.get("SYMBOL", "BTCUSDT")
ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache" / "binance"
OUT = ROOT / "weekly-vp.json"


def parse_day(day):
    zip_path = download_day(SYMBOL, day, CACHE)
    if zip_path is None:
        return None
    return parse_day_zip(zip_path)


def main():
    now = datetime.now(timezone.utc)
    today = now.date()
    monday = today - timedelta(days=today.weekday())
    prev_start = monday - timedelta(days=7)
    previous = [prev_start + timedelta(days=i) for i in range(7)]
    current = [monday + timedelta(days=i) for i in range(max(0, (today - monday).days))]
    previous_days, previous_rows = merge_days(previous, parse_day)
    current_days, current_rows = merge_days(current, parse_day)
    data = {
        "schema": "binance-vision-weekly-vp-v1",
        "symbol": SYMBOL,
        "generatedAt": now.isoformat().replace("+00:00", "Z"),
        "priceBin": "1 USDT",
        "previous": {
            "label": f"{prev_start.isoformat()} to {(monday - timedelta(days=1)).isoformat()}",
            "days": previous_days,
            "rows": previous_rows,
        },
        "current": {
            "label": f"{monday.isoformat()} to completed archived UTC days before {today.isoformat()}",
            "days": current_days,
            "rows": current_rows,
        },
    }
    OUT.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    print(
        "wrote", OUT,
        "previous_days", len(previous_days),
        "current_days", len(current_days),
        "rows", len(previous_rows), len(current_rows),
        flush=True,
    )


if __name__ == "__main__":
    main()
