from __future__ import annotations

import csv
import gzip
import io
import json
import zipfile
from collections import defaultdict
from decimal import Decimal, ROUND_FLOOR
from pathlib import Path


def price_to_bin_index(price: str, bin_size: str) -> int:
    p = Decimal(price)
    b = Decimal(bin_size)
    if b <= 0:
        raise ValueError("bin_size must be positive")
    return int((p / b).to_integral_value(rounding=ROUND_FLOOR))


def parse_aggtrades_csv(text_stream, bin_size: str):
    ladder = defaultdict(lambda: [Decimal("0"), Decimal("0")])
    reader = csv.reader(text_stream)
    first = True
    header = None
    trades = 0
    for row in reader:
        if not row:
            continue
        if first:
            first = False
            if not row[0].lstrip("-").isdigit():
                header = {value.strip().lower(): index for index, value in enumerate(row)}
                continue
        if header:
            price = row[header["price"]]
            quantity = Decimal(row[header["quantity"]])
            buyer_is_maker = row[header["is_buyer_maker"]].strip().lower() in ("true", "1")
        else:
            price = row[1]
            quantity = Decimal(row[2])
            buyer_is_maker = row[6].strip().lower() in ("true", "1")
        key = price_to_bin_index(price, bin_size)
        if buyer_is_maker:
            ladder[key][1] += quantity
        else:
            ladder[key][0] += quantity
        trades += 1
    return ladder, trades


def parse_day_zip(zip_path: Path, bin_size: str):
    with zipfile.ZipFile(zip_path) as archive:
        names = [name for name in archive.namelist() if name.lower().endswith(".csv")]
        if len(names) != 1:
            raise RuntimeError(f"unexpected zip members: {names}")
        with archive.open(names[0]) as raw:
            text = io.TextIOWrapper(raw, encoding="utf-8", newline="")
            return parse_aggtrades_csv(text, bin_size)


def ladder_rows(ladder) -> list[list]:
    return [
        [index, float(buy), float(sell)]
        for index, (buy, sell) in sorted(ladder.items())
    ]


def write_ladder_gz(path: Path, *, symbol: str, date: str, bin_size: str, source: str, zip_sha256: str, trades: int, ladder) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema": "ladder-v1",
        "symbol": symbol,
        "date": date,
        "binSize": bin_size,
        "source": source,
        "zipSha256": zip_sha256,
        "trades": trades,
        "rows": ladder_rows(ladder),
    }
    with gzip.open(path, "wt", encoding="utf-8") as file_out:
        json.dump(payload, file_out, separators=(",", ":"))


def load_ladder_gz(path: Path) -> dict:
    with gzip.open(path, "rt", encoding="utf-8") as file_in:
        return json.load(file_in)
