#!/usr/bin/env python3
"""Build a cached, approximate top-125 stablecoin dominance series from CoinGecko Demo."""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API_BASE = "https://api.coingecko.com/api/v3"
STABLE = ("tether", "usd-coin", "dai")
EXCLUDED_CATEGORIES = ("wrapped-tokens", "liquid-staking-tokens")
SCHEMA = "ssd-v1"
SOURCE = "CoinGecko Demo API"
DENOMINATOR = "top-125 excl. wrapped & liquid staking"


def warn(message):
    # Do not log request headers, authorization details, or secrets.
    print("::warning::D20 SSD: " + str(message).replace("\n", " ")[:300], flush=True)


def timestamp(value):
    return value.astimezone(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def empty_cache():
    return {
        "schema": SCHEMA,
        "generatedAt": None,
        "source": SOURCE,
        "denominator": DENOMINATOR,
        "constituentsUpdatedAt": None,
        "constituents": [],
        "calibration": {},
        "points": [],
    }


def load_cache(path):
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("points"), list):
            return data
    except (OSError, ValueError, TypeError):
        pass
    return empty_cache()


def save_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    temp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(temp, path)


def top_125(markets, excluded, count=125):
    valid = sorted(
        (r for r in markets if r.get("id") and isinstance(r.get("market_cap"), (int, float))),
        key=lambda r: (-r["market_cap"], str(r["id"])),
    )
    unique, ids = set(), []
    for row in valid:
        name = str(row["id"])
        if name in unique or name in excluded:
            continue
        unique.add(name)
        ids.append(name)
        if len(ids) == count:
            break
    return ids


def utc_daily_values(chart):
    """Keep only the UTC midnight observations from CoinGecko's market_caps array."""
    daily = {}
    for point in chart.get("market_caps", []):
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            continue
        try:
            sample = dt.datetime.fromtimestamp(float(point[0]) / 1000, tz=dt.timezone.utc)
            value = float(point[1])
            if sample.hour == 0 and sample.minute == 0 and sample.second == 0 and value >= 0:
                daily[sample.date().isoformat()] = value
        except (ValueError, TypeError, OverflowError, OSError):
            continue
    return daily


def aggregate_backfill(charts, constituents, fetched_at, start_date=None):
    stable_dates = set().union(*(set(charts.get(s, {})) for s in STABLE))
    expected = set(constituents).union(STABLE)
    rows = []
    for date in sorted(stable_dates):
        if start_date and date < start_date:
            continue
        amounts = {name: charts.get(name, {}).get(date) for name in expected}
        total = sum(float(amounts[s] or 0) for s in constituents)
        usdt = float(amounts["tether"] or 0)
        usdc = float(amounts["usd-coin"] or 0)
        dai = float(amounts["dai"] or 0)
        missing = sum(amounts[name] is None for name in expected)
        if total <= 0:
            continue
        rows.append({
            "date": date, "usdt": usdt, "usdc": usdc, "dai": dai,
            "total": total, "raw": (usdt + usdc + dai) / total * 100,
            "fetchedAt": fetched_at, "missingCoins": missing,
        })
    return rows


def append_if_absent(points, point):
    if any(row.get("date") == point.get("date") for row in points):
        return False
    points.append(point)
    points.sort(key=lambda row: row["date"])
    return True


def daily_point(markets, constituents, date, fetched_at):
    by_id = {str(r["id"]): r.get("market_cap") for r in markets if r.get("id")}
    expected = set(constituents).union(STABLE)
    def value(id_):
        amount = by_id.get(id_)
        return float(amount) if isinstance(amount, (int, float)) and amount >= 0 else 0.0

    total = sum(value(name) for name in constituents)
    if total <= 0:
        raise ValueError("denominator has no available market caps")
    usdt, usdc, dai = (value(name) for name in STABLE)
    return {
        "date": date, "usdt": usdt, "usdc": usdc, "dai": dai,
        "total": total, "raw": (usdt + usdc + dai) / total * 100,
        "fetchedAt": fetched_at,
        "missingCoins": sum(by_id.get(name) is None for name in expected),
    }


def calibrate(cache, reference_date, reference_value):
    ref = next((p for p in cache.get("points", []) if p.get("date") == reference_date), None)
    raw = float(ref["raw"]) if ref and ref.get("raw") is not None else None
    ratio = raw / reference_value if raw is not None and reference_value > 0 else None
    cache["calibration"] = {
        "date": reference_date, "tvValue": reference_value,
        "raw": raw, "ratio": ratio,
        "method": "value = raw / ratio (TradingView anchor)",
    }
    if ratio is not None and abs(ratio - 1) > 0.05:
        warn("calibration ratio differs from 1 by more than 5%")
    return ratio


class DemoClient:
    def __init__(self, key, min_spacing=2.1, sleeper=time.sleep, clock=time.monotonic):
        self._key = key
        self._spacing = min_spacing
        self._sleep = sleeper
        self._clock = clock
        self._last = None

    def get(self, path, **params):
        url = API_BASE + path + "?" + urllib.parse.urlencode(params)
        for attempt in range(6):
            if self._last is not None:
                self._sleep(max(0.0, self._spacing - (self._clock() - self._last)))
            self._last = self._clock()
            request = urllib.request.Request(
                url,
                headers={"x-cg-demo-api-key": self._key, "accept": "application/json"},
            )
            try:
                with urllib.request.urlopen(request, timeout=35) as response:
                    return json.load(response)
            except urllib.error.HTTPError as error:
                if error.code == 429 and attempt < 5:
                    self._sleep(min(90, 5 * 2 ** attempt))
                    continue
                raise RuntimeError("CoinGecko HTTP " + str(error.code)) from None
            except (urllib.error.URLError, TimeoutError, ValueError):
                if attempt < 2:
                    self._sleep(3 * 2 ** attempt)
                    continue
                raise RuntimeError("CoinGecko request failed") from None
        raise RuntimeError("CoinGecko throttled after retries")

    def market_rows(self, category=None, max_pages=4):
        rows = []
        for page in range(1, max_pages + 1):
            params = dict(vs_currency="usd", order="market_cap_desc",
                          per_page=250, page=page, sparkline="false")
            if category:
                params["category"] = category
            batch = self.get("/coins/markets", **params)
            if not isinstance(batch, list):
                raise RuntimeError("unexpected CoinGecko markets response")
            rows.extend(batch)
            if len(batch) < 250:
                break
        return rows

    def history(self, coin_id):
        return self.get(
            "/coins/" + urllib.parse.quote(coin_id, safe="") + "/market_chart",
            vs_currency="usd", days=365, interval="daily",
        )


def build_ssd(cache_dir, output_dir, key=None, today=None, client=None, rules_path=None):
    today = today or dt.datetime.now(dt.timezone.utc)
    current_date = today.date().isoformat()
    fetched_at = timestamp(today)
    cache_path = Path(cache_dir) / "ssd.json"
    output_path = Path(output_dir) / "ssd.json"
    cache = load_cache(cache_path)
    cache.update(schema=SCHEMA, source=SOURCE, denominator=DENOMINATOR)
    rules_path = Path(rules_path or "config/analysis-rules.json")
    try:
        config = json.loads(rules_path.read_text(encoding="utf-8"))
        cal = config.get("ssd", {}).get("calibration", {})
        reference_date = str(cal.get("date", "2026-10-05"))
        reference_value = float(cal.get("tvValue", 9.118))
    except (OSError, ValueError, TypeError):
        reference_date, reference_value = "2026-10-05", 9.118

    key = key if key is not None else os.environ.get("COINGECKO_DEMO_API_KEY", "")
    if not key:
        warn("Demo API key absent; preserving cached series")
    else:
        api = client or DemoClient(key)
        updated = copy.deepcopy(cache)
        try:
            previous_month = str(updated.get("constituentsUpdatedAt") or "")[:7]
            if previous_month != current_date[:7] or len(updated.get("constituents", [])) != 125:
                markets = api.market_rows()
                exclusions = set()
                for category in EXCLUDED_CATEGORIES:
                    exclusions.update(str(row["id"]) for row in api.market_rows(category=category) if row.get("id"))
                members = top_125(markets, exclusions)
                if len(members) != 125:
                    raise RuntimeError("could not select 125 denominator constituents")
                updated["constituents"] = members
                updated["constituentsUpdatedAt"] = current_date + "T00:00:00Z"
            else:
                markets = api.market_rows(max_pages=2)

            if not updated.get("points"):
                charts = {}
                for coin in dict.fromkeys(list(updated["constituents"]) + list(STABLE)):
                    charts[coin] = utc_daily_values(api.history(coin))
                first = (today.date() - dt.timedelta(days=365)).isoformat()
                updated["points"] = aggregate_backfill(charts, updated["constituents"], fetched_at, first)

            if not any(p.get("date") == current_date for p in updated["points"]):
                append_if_absent(updated["points"], daily_point(markets, updated["constituents"], current_date, fetched_at))

            updated["generatedAt"] = fetched_at
            cache = updated
            save_json(cache_path, cache)
        except Exception as error:
            # API errors cannot halt the standard Binance pipeline or discard prior data.
            warn("API unavailable; keeping previous cache (" + type(error).__name__ + ")")

    calibrate(cache, reference_date, reference_value)
    save_json(output_path, cache)
    if key and cache.get("points"):
        save_json(cache_path, cache)
    print("D20 SSD: " + str(len(cache.get("points", []))) + " cached points", flush=True)
    return cache


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", default="datarepo/macro")
    parser.add_argument("--output-dir", default="_generated/analysis/macro")
    parser.add_argument("--rules", default="config/analysis-rules.json")
    options = parser.parse_args()
    build_ssd(options.cache_dir, options.output_dir, rules_path=options.rules)


if __name__ == "__main__":
    main()
