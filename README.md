# Order Flow Analysis

Private research dashboard for Binance USD-M perpetual order flow.

## Web dashboard

- Live Binance `aggTrade` WebSocket
- Executed-volume profile by reported trade price
- Bid x Ask footprint
- Event-sequenced CVD
- Weekly VP generated from verified `data.binance.vision` daily `aggTrades` archives

The hot-flow chart only claims the data actually captured or seeded in the browser. It does not label a short cold-start sample as a complete 4h/8h/12h window.

## Data policy

Read-only public market data. No trading permissions, wallet connection, order placement, or private Binance API endpoints.

## Deployment

GitHub Actions generates `weekly-vp.json` and deploys the static dashboard to GitHub Pages.

If Pages has never been enabled for this repository, open:

**Settings → Pages → Build and deployment → Source: GitHub Actions**

Note: a private GitHub repository does not automatically guarantee that its Pages website is private. Page visibility depends on your GitHub plan and Pages access-control settings.
