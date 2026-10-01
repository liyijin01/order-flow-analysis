项目进度、关键决定和历史任务文档见 [docs/](docs/README.md)。

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

## Flow Board

`flow.html` is the finished 15m / 30m order-flow board for BTCUSDT, ETHUSDT and SOLUSDT. It combines:

- Binance USD-M perpetual candlesticks with deterministic anchored VWAP, running ±1σ fill and ±2σ lines;
- separate USDT-notional CVD panes for Binance Perpetual and Binance Spot using `2 × takerBuyQuote - quoteVolume`;
- three archived USD-M book-depth buckets derived from checksum-verified Binance Vision `bookDepth` files;
- the actual probed depth buckets `0–1%`, `1–2%`, `2–5%` because the archive exposes ±0.2/1/2/3/4/5% levels and no ±2.5% level;
- six daily snapshot PNGs and `flow/latest.json`.

Validated 15m as-of depth samples are persisted under `depth15m/{SYMBOL}/{YYYY-MM-DD}.json.gz` on the orphan `data` branch; raw bookDepth snapshots are not retained. Invalid depth snapshots are rejected rather than interpolated. If a daily archive is systemically bad (at least 5% of its snapshots fail the configured validation), the entire UTC day is quarantined and left blank; `flow/latest.json` reports the invalid days and raw invalid snapshot count separately. The depth pane intentionally stops at the latest completed archived UTC day; it is not spliced with REST depth.


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

GitHub Actions runs daily at 09:25 UTC. The data job:

1. checks out or initializes the orphan `data` branch;
2. downloads only missing completed UTC daily aggTrades archives;
3. verifies Binance SHA-256 checksums;
4. writes `ladders/{SYMBOL}/{YYYY-MM-DD}.json.gz` and deletes the raw ZIP;
5. generates `profiles-{SYMBOL}.json` with explicit completeness fields;
6. refuses to publish if there is no usable archive data for any configured symbol.

A missing Binance Vision file (HTTP 404) is recorded as a missing day rather than interpolated. Other network failures are retried three times with exponential backoff. A checksum mismatch triggers one fresh re-download before the day is marked failed.

## Deployment

Pull requests run only the read-only test job. Data-branch write permission is scoped to the `data` job. GitHub Pages permissions are scoped to `build`/`deploy`, with the OIDC token available only to `deploy`.
