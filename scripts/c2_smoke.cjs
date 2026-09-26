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
      openTime, open.toFixed(4), high.toFixed(4), low.toFixed(4), close.toFixed(4), volume.toFixed(3),
      openTime + 3599999, (volume * close).toFixed(3), 100 + (i % 50),
      (volume * 0.53).toFixed(3), (volume * close * 0.53).toFixed(3), '0'
    ]);
  }
  return rows;
}

(async () => {
  const outDir = path.resolve('c2-smoke-artifacts');
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const presets = ['p1','p2','p3','p4','p5'];
  const consoleErrors = [];

  try {
    for (const preset of presets) {
      const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 1 });
      page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(preset + ': ' + msg.text()); });
      page.on('pageerror', (err) => consoleErrors.push(preset + ': ' + err.message));

      await page.route(/https:\/\/(fapi\.binance\.com|api\.binance\.com)\/.*klines.*/, async (route) => {
        const url = new URL(route.request().url());
        const symbol = url.searchParams.get('symbol') || 'BTCUSDT';
        const all = fixtureRows(symbol);
        const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit')) || 500, all.length));
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(all.slice(-limit)) });
      });

      await page.goto('http://127.0.0.1:8000/chart.html?fixture=' + preset, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => {
        const s=document.getElementById('status');
        const d=window.__orderFlowChartDebug;
        return s && s.textContent.includes('annotations ') && d && d.annotationStats().rendered > 0;
      }, { timeout: 30000 });

      const stats=await page.evaluate(()=>window.__orderFlowChartDebug.annotationStats());
      if(stats.skipped!==0)throw new Error(preset+' unexpectedly skipped '+stats.skipped+' annotations');

      const before=await page.evaluate(()=>window.__orderFlowChartDebug.annotationCoordinates());
      await page.evaluate(()=>{
        const chart=window.__orderFlowChartDebug.chart;
        chart.timeScale().setVisibleLogicalRange({from:120,to:340});
      });
      await page.waitForTimeout(250);
      const after=await page.evaluate(()=>window.__orderFlowChartDebug.annotationCoordinates());
      const moved=before.some((p,i)=>p && after[i] && Number.isFinite(p.x) && Number.isFinite(after[i].x) && Math.abs(p.x-after[i].x)>0.5);
      if(!moved)throw new Error(preset+' annotation coordinates did not move after pan/zoom');

      await page.selectOption('#exportSize','1920x1080');
      const downloadPromise=page.waitForEvent('download',{timeout:30000});
      await page.click('#exportBtn');
      const download=await downloadPromise;
      const target=path.join(outDir,preset+'-1920x1080.png');
      await download.saveAs(target);
      if(fs.statSync(target).size<15000)throw new Error(preset+' export too small');

      await page.screenshot({path:path.join(outDir,preset+'-page.png'),fullPage:true});
      await page.close();
    }
  } finally {
    await browser.close();
  }

  if(consoleErrors.length){
    console.error(consoleErrors.join('\n'));
    process.exit(1);
  }
  console.log('C2 browser smoke passed for P1-P5: render, pan/zoom, and PNG export.');
})().catch((err)=>{console.error(err);process.exit(1);});
