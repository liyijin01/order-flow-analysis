from __future__ import annotations

import hashlib
import shutil
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

BASE = "https://data.binance.vision/data/futures/um/daily/aggTrades/{s}/{s}-aggTrades-{d}.zip"
USER_AGENT = "order-flow-analysis/0.2"


@dataclass(frozen=True)
class DownloadResult:
    status: str  # ok | missing | failed
    zip_path: Path | None = None
    sha256: str | None = None
    error: str | None = None


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file_in:
        for chunk in iter(lambda: file_in.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().lower()


def _request(url: str, timeout: int = 120):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    return urllib.request.urlopen(request, timeout=timeout)


def fetch_text(url: str, retries: int = 3, sleep=time.sleep) -> tuple[str, str | None]:
    last_error = None
    for attempt in range(retries):
        try:
            with _request(url, 90) as response:
                return "ok", response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return "missing", None
            last_error = exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
        if attempt + 1 < retries:
            sleep(2**attempt)
    return "failed", str(last_error) if last_error else "unknown network error"


def _download_file(url: str, destination: Path, retries: int = 3, sleep=time.sleep) -> tuple[str, str | None]:
    last_error = None
    for attempt in range(retries):
        try:
            with _request(url, 180) as response, destination.open("wb") as file_out:
                shutil.copyfileobj(response, file_out, 1024 * 1024)
            return "ok", None
        except urllib.error.HTTPError as exc:
            destination.unlink(missing_ok=True)
            if exc.code == 404:
                return "missing", None
            last_error = exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            destination.unlink(missing_ok=True)
            last_error = exc
        if attempt + 1 < retries:
            sleep(2**attempt)
    return "failed", str(last_error) if last_error else "unknown network error"


def download_verified_url(url: str, temp_dir: Path, filename: str, sleep=time.sleep) -> DownloadResult:
    temp_dir.mkdir(parents=True, exist_ok=True)
    zip_path = temp_dir / filename

    checksum_status, checksum_text = fetch_text(url + ".CHECKSUM", sleep=sleep)
    if checksum_status == "missing":
        return DownloadResult("missing")
    if checksum_status != "ok" or not checksum_text:
        return DownloadResult("failed", error=f"checksum download failed: {checksum_text}")
    expected = checksum_text.strip().split()[0].lower()

    for checksum_attempt in range(2):
        status, error = _download_file(url, zip_path, sleep=sleep)
        if status == "missing":
            return DownloadResult("missing")
        if status != "ok":
            return DownloadResult("failed", error=f"archive download failed: {error}")
        actual = sha256_file(zip_path)
        if actual == expected:
            return DownloadResult("ok", zip_path=zip_path, sha256=actual)
        zip_path.unlink(missing_ok=True)
        if checksum_attempt == 0:
            continue
        return DownloadResult("failed", error=f"checksum mismatch: expected {expected}, got {actual}")
    return DownloadResult("failed", error="unexpected checksum state")


def download_verified_day(symbol: str, day, temp_dir: Path, sleep=time.sleep) -> DownloadResult:
    ds = day.isoformat()
    url = BASE.format(s=symbol, d=ds)
    return download_verified_url(url, temp_dir, f"{symbol}-aggTrades-{ds}.zip", sleep=sleep)
