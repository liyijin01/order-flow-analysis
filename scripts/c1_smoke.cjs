const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

function fixtureRows(symbol) {
  const bases = { BTCUSDT: 82000, ETHUSDT: 3200, SOLUSDT: 185 };
  const base = bases[symbol] || 100;
  const start = Date.UTC(2026, 8, 1, 0, 0, 0);
  const rows = [];
  for (let i = 0; i < 500; i += 1) {
    const openTime = start + i * 3600000;
    const drift = Math.sin(i / 17) * base * 0.018 + i * base * 0.00003;
    const open = base + drift;
    const close = open + Math.sin(i / 5) * base * 0.003;
    const high = Math.max(open, close) + base * 0.0025;
    const low = Math.min(open, close) - base * 0.0025;
    const volume = 100 + (i % 37) * 7;
    rows.push([
      openTime,
      open.toFixed(4),
      high.toFixed(4),
      low.toFixed(4),
      close.toFixed(4),
      volume.toFixed(3),
      openTime + 3599999,
      (volume * close).toFixed(3),
      100 + (i % 50),
      (volume * 0.53).toFixed(3),
      (volume * close * 0.53).toFixed(3),
      '0'
    ]);
  }
  return rows;
}

(async () => {
  const outDir = path.resolve('c1-smoke-artifacts');
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
  const consoleErrors = [];

  try {
    for (const symbol of symbols) {
      const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 1 });
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(symbol + ': ' + msg.text());
      });
      page.on('pageerror', (err) => consoleErrors.push(symbol + ': ' + err.message));

      await page.route(/https:\/\/(fapi\.binance\.com|api\.binance\.com)\/.*klines.*/, async (route) => {
        const url = new URL(route.request().url());
        const requested = url.searchParams.get('symbol') || symbol;
        const all = fixtureRows(requested);
        const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit')) || 500, all.length));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(all.slice(-limit)),
        });
      });

      const url = 'http://127.0.0.1:8000/chart.html?symbol=' + symbol + '&market=um&interval=1h';
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => {
        const s = document.getElementById('status');
        return s && s.textContent.startsWith('Loaded ');
      }, { timeout: 30000 });

      await page.selectOption('#exportSize', '1920x1080');
      const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
      await page.click('#exportBtn');
      const download = await downloadPromise;
      const target = path.join(outDir, symbol + '-1h-1920x1080.png');
      await download.saveAs(target);
      const stat = fs.statSync(target);
      if (stat.size < 10000) throw new Error(symbol + ' export too small: ' + stat.size);

      const pageShot = path.join(outDir, symbol + '-page.png');
      await page.screenshot({ path: pageShot, fullPage: true });
      await page.close();
    }
  } finally {
    await browser.close();
  }

  if (consoleErrors.length) {
    console.error(consoleErrors.join('\n'));
    process.exit(1);
  }
  console.log('C1 browser smoke passed for BTCUSDT, ETHUSDT, SOLUSDT with deterministic kline fixtures.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
