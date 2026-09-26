# Order Flow Analysis

Read-only research dashboard for Binance USD-M perpetual order flow.

## Current dashboard

- Live Binance `aggTrade` WebSocket for BTCUSDT, ETHUSDT and SOLUSDT
- Executed-volume profile and Bid × Ask footprint
- CVD aggregated to bounded OHLC buckets instead of one SVG point per trade
- aggTrade ID gap detection and public REST `fromId` repair
- Automatic WebSocket reconnect with exponential backoff and proactive 23-hour rotation
- Weekly archive profiles generated from checksum-verified `data.binance.vision` daily aggTrades
- Per-symbol exact ladder binning configured in `config/symbols.json`
- Persistent daily ladder files on the orphan `data` branch
- Explicit `expectedDays`, `days`, `missingDays` and `complete` archive metadata

The dashboard uses only public market-data endpoints. It has no API keys, wallet connection, order placement, or private account access.

## Local preview

The browser code uses classic scripts, so double-clicking `index.html` no longer fails because of ES-module CORS. In `file://` mode the live WebSocket can still run, but browsers generally block fetching sibling JSON archive files.

For the full page including archive profiles, serve the repository locally:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/`.

The in-browser trade cap defaults to 1,000,000 events. It is configurable, for example:

`http://localhost:8000/?maxTrades=2000000`

If the cap truncates older trades, the coverage line reports it explicitly.

## Tests

```bash
python -m unittest discover pipeline/tests -v
node --test web/tests/*.test.mjs
node --check web/core.js
node --check web/live.js
node --check web/render.js
node --check web/app.js
```

Tests are fixture-based and do not require network access.

## Archive data pipeline

`config/symbols.json` defines the exact ladder size and UI defaults for every symbol. Python uses `decimal.Decimal` to calculate `binIndex`; it does not use float division for archive price bins.

GitHub Actions runs twice daily at 01:40 and 09:40 UTC. The data job:

1. checks out or initializes the orphan `data` branch;
2. downloads only missing completed UTC daily aggTrades archives;
3. verifies Binance SHA-256 checksums;
4. writes `ladders/{SYMBOL}/{YYYY-MM-DD}.json.gz` and deletes the raw ZIP;
5. generates `profiles-{SYMBOL}.json` with explicit completeness fields;
6. refuses to publish if there is no usable archive data for any configured symbol.

A missing Binance Vision file (HTTP 404) is recorded as a missing day rather than interpolated. Other network failures are retried three times with exponential backoff. A checksum mismatch triggers one fresh re-download before the day is marked failed.

## Deployment

Pull requests run only the read-only test job. Data-branch write permission is scoped to the `data` job. GitHub Pages permissions are scoped to `build`/`deploy`, with the OIDC token available only to `deploy`.
