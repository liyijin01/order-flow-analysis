from __future__ import annotations

import hashlib
import shutil
import urllib.request
from pathlib import Path

BASE = "https://data.binance.vision/data/futures/um/daily/aggTrades/{s}/{s}-aggTrades-{d}.zip"
USER_AGENT = "order-flow-analysis/0.1"


def fetch_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=90) as response:
        return response.read().decode("utf-8")


def download_day(symbol: str, day, cache: Path):
    ds = day.isoformat()
    url = BASE.format(s=symbol, d=ds)
    cache.mkdir(parents=True, exist_ok=True)
    zip_path = cache / f"{symbol}-aggTrades-{ds}.zip"
    checksum_path = cache / f"{symbol}-aggTrades-{ds}.zip.CHECKSUM"
    try:
        if not checksum_path.exists():
            checksum_path.write_text(fetch_text(url + ".CHECKSUM"), encoding="utf-8")
        expected = checksum_path.read_text(encoding="utf-8").strip().split()[0].lower()
        if not zip_path.exists():
            print("download", url, flush=True)
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=180) as response, open(zip_path, "wb") as file_out:
                shutil.copyfileobj(response, file_out, 1024 * 1024)
        digest = hashlib.sha256()
        with open(zip_path, "rb") as file_in:
            for chunk in iter(lambda: file_in.read(1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest().lower() != expected:
            zip_path.unlink(missing_ok=True)
            raise RuntimeError(f"checksum mismatch {ds}")
        return zip_path
    except Exception as exc:
        print("skip", ds, type(exc).__name__, exc, flush=True)
        return None
