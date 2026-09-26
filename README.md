# Order Flow Analysis

Research dashboard for Binance USD-M perpetual order flow.

## Web dashboard

- Live Binance `aggTrade` WebSocket
- Executed-volume profile by reported trade price
- Bid x Ask footprint
- Event-sequenced CVD
- Weekly VP generated from verified `data.binance.vision` daily `aggTrades` archives

The hot-flow chart only claims the data actually captured or seeded in the browser. It does not label a short cold-start sample as a complete 4h/8h/12h window.

## Data policy

Read-only public market data. No trading permissions, wallet connection, order placement, or private Binance API endpoints.

## Tests

```bash
python -m unittest discover pipeline/tests
node --test web/tests/*.test.mjs
```

Both suites use local fixtures only and do not require network access.

## Deployment

GitHub Actions runs the Python and JavaScript tests, generates `weekly-vp.json`, and deploys the static dashboard to GitHub Pages from `main`.

Pages source: **GitHub Actions**.
