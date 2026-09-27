const {chromium}=require('playwright-core');

const pageUrl='http://127.0.0.1:8000/analysis.html';
const intervalSec={'30m':1800,'1h':3600,'4h':14400,'1d':86400,'1w':604800};
const baseMap={BTCUSDT:82000,ETHUSDT:2700,SOLUSDT:120};
const cache=new Map();

function rows(symbol,interval){
  const key=symbol+'|'+interval;if(cache.has(key))return cache.get(key);
  const sec=intervalSec[interval],base=baseMap[symbol]||100,end=Math.floor(Date.UTC(2026,8,27,0,0,0)/1000);
  const count=interval==='1h'?5200:interval==='30m'?3800:interval==='4h'?700:interval==='1d'?500:380;
  const start=end-sec*(count-1),out=[];
  for(let i=0;i<count;i++){
    const t=(start+i*sec)*1000,wave=Math.sin(i/37)*base*.045+Math.cos(i/83)*base*.025;
    const trend=Math.sin(i/700)*base*.025,open=base+wave+trend,delta=Math.sin(i/11)*base*.004,close=open+delta;
    const high=Math.max(open,close)+base*.004,low=Math.min(open,close)-base*.004,vol=1000+(i%47)*17;
    const buy=delta>=0?vol*.62:vol*.38;
    out.push([t,open.toFixed(8),high.toFixed(8),low.toFixed(8),close.toFixed(8),vol.toFixed(4),t+sec*1000-1,(vol*close).toFixed(4),100,buy.toFixed(4),(buy*close).toFixed(4),'0']);
  }
  cache.set(key,out);return out;
}

async function routeMarket(page){
  await page.route(/https:\/\/fapi\.binance\.com\/fapi\/v1\/klines.*/,async route=>{
    const u=new URL(route.request().url()),symbol=u.searchParams.get('symbol'),interval=u.searchParams.get('interval');
    const end=Number(u.searchParams.get('endTime'))||Infinity,limit=Math.min(1500,Number(u.searchParams.get('limit'))||500);
    const body=rows(symbol,interval).filter(r=>Number(r[0])<=end).slice(-limit);
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
}

function verifyLimits(model){
  const values=model.regions.filter(r=>r.type==='value');
  const supply=model.regions.filter(r=>r.type==='supply');
  const demand=model.regions.filter(r=>r.type==='demand');
  const npoc=model.levels.filter(l=>l.kind==='npoc');
  if(values.length>3||supply.length>2||demand.length>2||npoc.length>2)throw new Error('quantity limits failed '+JSON.stringify({values:values.length,supply:supply.length,demand:demand.length,npoc:npoc.length}));
}

(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1600,height:1000}});
    await routeMarket(page);
    await page.goto(pageUrl+'?symbol=ETHUSDT&tf=1h',{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
    const first=await page.evaluate(()=>({
      model:window.__analysisDebug.model,
      axis:window.__analysisDebug.axisLabels(),
      volume:window.__analysisDebug.volumeFormat()
    }));
    if(!first.model.regions.some(r=>r.scope==='PQ'))throw new Error('1h board failed data independence: PQ missing');
    if(first.model.display.length!==720)throw new Error('1h display count '+first.model.display.length);
    if(!first.volume||first.volume.type!=='volume')throw new Error('volume format not preserved');
    verifyLimits(first.model);
    for(const a of first.axis.filter(x=>x.visible))if(a.diff==null||a.diff>1)throw new Error('axis label off true price '+JSON.stringify(a));

    await page.evaluate(()=>window.__analysisDebug.state.chart.priceScale('right').applyOptions({scaleMargins:{top:.05,bottom:.28}}));
    await page.waitForTimeout(250);
    const scaled=await page.evaluate(()=>window.__analysisDebug.axisLabels());
    for(const a of scaled.filter(x=>x.visible))if(a.diff==null||a.diff>1)throw new Error('axis label shifted after scale '+JSON.stringify(a));

    await page.evaluate(()=>window.__analysisDebug.state.chart.timeScale().scrollToPosition(12,false));
    await page.waitForTimeout(150);
    const panned=await page.evaluate(()=>window.__analysisDebug.axisLabels());
    for(const a of panned.filter(x=>x.visible))if(a.diff==null||a.diff>1)throw new Error('axis label shifted after pan '+JSON.stringify(a));

    await page.evaluate(()=>window.__analysisDebug.refresh());
    await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
    const refreshed=await page.evaluate(()=>window.__analysisDebug.axisLabels());
    for(const a of refreshed.filter(x=>x.visible))if(a.diff==null||a.diff>1)throw new Error('axis label shifted after refresh '+JSON.stringify(a));

    console.log('D1 browser smoke passed: PQ independence, limits, exact axis coordinates, and volume format.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
