from __future__ import annotations

import csv
import io
import zipfile
from collections import defaultdict


def parse_aggtrades_csv(text_stream):
    """Parse Binance aggTrades CSV and preserve the existing 1-USDT floor binning."""
    ladder = defaultdict(lambda: [0.0, 0.0])
    reader = csv.reader(text_stream)
    first = True
    header = None
    for row in reader:
        if not row:
            continue
        if first:
            first = False
            if not row[0].lstrip("-").isdigit():
                header = {value.strip().lower(): index for index, value in enumerate(row)}
                continue
        if header:
            price = float(row[header["price"]])
            quantity = float(row[header["quantity"]])
            buyer_is_maker = row[header["is_buyer_maker"]].strip().lower() in ("true", "1")
        else:
            price = float(row[1])
            quantity = float(row[2])
            buyer_is_maker = row[6].strip().lower() in ("true", "1")
        key = int(price)
        if buyer_is_maker:
            ladder[key][1] += quantity
        else:
            ladder[key][0] += quantity
    return ladder


def parse_day_zip(zip_path):
    with zipfile.ZipFile(zip_path) as archive:
        names = [name for name in archive.namelist() if name.lower().endswith(".csv")]
        if len(names) != 1:
            raise RuntimeError(f"unexpected zip members: {names}")
        with archive.open(names[0]) as raw:
            text = io.TextIOWrapper(raw, encoding="utf-8", newline="")
            return parse_aggtrades_csv(text)
