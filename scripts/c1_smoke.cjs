const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

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

      const url = 'http://127.0.0.1:8000/chart.html?symbol=' + symbol + '&market=um&interval=1h';
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForFunction(() => {
        const s = document.getElementById('status');
        return s && s.textContent.startsWith('Loaded ');
      }, { timeout: 60000 });

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
  console.log('C1 browser smoke passed for BTCUSDT, ETHUSDT, SOLUSDT.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
