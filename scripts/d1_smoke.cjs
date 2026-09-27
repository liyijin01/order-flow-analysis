const {chromium}=require('playwright-core');

const pageUrl='http://127.0.0.1:8000/analysis.html';
const intervalSec={'30m':1800,'1h':3600,'4h':14400,'1d':86400,'1w':604800};
const baseMap={BTCUSDT:82000,ETHUSDT:2700,SOLUSDT:120};
const displayCount={'4h':540,'1h':720,'1d':365};
const expectedVisible={'4h':180,'1h':240,'1d':180};
const cache=new Map();

function rows(symbol,interval){
  const key=symbol+'|'+interval;if(cache.has(key))return cache.get(key);
  const sec=intervalSec[interval],base=baseMap[symbol]||100;
  const end=interval==='1w'
    ?Math.floor(Date.UTC(2026,8,21,0,0,0)/1000) // Monday anchor
    :Math.floor(Date.UTC(2026,8,27,0,0,0)/1000);
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

async function routeMarket(page,requests){
  await page.route(/https:\/\/fapi\.binance\.com\/fapi\/v1\/klines.*/,async route=>{
    const u=new URL(route.request().url()),symbol=u.searchParams.get('symbol'),interval=u.searchParams.get('interval');
    const endRaw=u.searchParams.get('endTime'),end=endRaw==null?Infinity:Number(endRaw);
    const limit=Math.min(1500,Number(u.searchParams.get('limit'))||500);
    requests.push({interval,limit,endTime:endRaw});
    const body=rows(symbol,interval).filter(r=>Number(r[0])<=end).slice(-limit);
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
}

function verifyLimits(model){
  const values=model.allRegions.filter(r=>r.type==='value');
  const supply=model.allRegions.filter(r=>r.type==='supply');
  const demand=model.allRegions.filter(r=>r.type==='demand');
  const npoc=model.allLevels.filter(l=>l.kind==='npoc');
  if(values.length>3||supply.length>2||demand.length>2||npoc.length>2)throw new Error('quantity limits failed '+JSON.stringify({values:values.length,supply:supply.length,demand:demand.length,npoc:npoc.length}));
}

async function verifyAxis(page,label){
  const axis=await page.evaluate(()=>window.__analysisDebug.axisLabels());
  for(const a of axis.filter(x=>x.visible))if(a.diff==null||a.diff>1)throw new Error(label+' axis label off true price '+JSON.stringify(a));
}

(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    for(const tf of ['4h','1h','1d']){
      const page=await browser.newPage({viewport:{width:1600,height:1000}});
      const requests=[];await routeMarket(page,requests);
      await page.goto(pageUrl+'?symbol=ETHUSDT&tf='+tf,{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
      const first=await page.evaluate(()=>({
        model:window.__analysisDebug.model,
        view:window.__analysisDebug.view(),
        candleTimes:window.__analysisDebug.candleTimes(),
        vwapTimes:window.__analysisDebug.vwapTimes(),
        volume:window.__analysisDebug.volumeFormat(),
        paneHeight:window.__analysisDebug.mainPaneHeight(),
        yMin:window.__analysisDebug.priceCoordinate(window.__analysisDebug.model.viewMin),
        yMax:window.__analysisDebug.priceCoordinate(window.__analysisDebug.model.viewMax)
      }));
      if(!first.model.allRegions.some(r=>r.scope==='PQ'))throw new Error(tf+' failed data independence: PQ missing');
      if(first.model.display.length!==displayCount[tf])throw new Error(tf+' display count '+first.model.display.length);
      if(first.model.visibleBars!==expectedVisible[tf])throw new Error(tf+' visibleBars '+first.model.visibleBars);
      if(!first.volume||first.volume.type!=='volume')throw new Error(tf+' volume format not preserved');
      verifyLimits(first.model);

      const candleSet=new Set(first.candleTimes);
      if(first.vwapTimes.length>first.candleTimes.length||!first.vwapTimes.every(t=>candleSet.has(t))){
        throw new Error(tf+' VWAP introduced non-display timestamps');
      }
      const targetSpan=first.model.visibleBars+30;
      if(!Number.isFinite(first.view.logicalSlots)||Math.abs(first.view.logicalSlots-targetSpan)>2){
        throw new Error(tf+' default view span '+first.view.logicalSlots+' expected '+targetSpan);
      }
      const occupied=Number(first.yMin)-Number(first.yMax);
      if(!(occupied>=.6*Number(first.paneHeight))){
        throw new Error(tf+' visible price range occupies only '+occupied+' of pane '+first.paneHeight);
      }
      await verifyAxis(page,tf+' initial');

      if(tf==='1h'){
        await page.evaluate(()=>window.__analysisDebug.state.chart.priceScale('right').applyOptions({scaleMargins:{top:.05,bottom:.28}}));
        await page.waitForTimeout(200);await verifyAxis(page,'1h scaled');
        await page.evaluate(()=>window.__analysisDebug.state.chart.timeScale().setVisibleLogicalRange({from:600,to:700}));
        await page.waitForTimeout(100);
        const before=await page.evaluate(()=>window.__analysisDebug.state.chart.timeScale().getVisibleLogicalRange());
        requests.length=0;
        await page.evaluate(()=>window.__analysisDebug.refresh());
        await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded ')||document.getElementById('status')?.textContent.startsWith('刷新失败'),{timeout:30000});
        const after=await page.evaluate(()=>window.__analysisDebug.state.chart.timeScale().getVisibleLogicalRange());
        if(Math.abs(Number(after.from)-Number(before.from))>1||Math.abs(Number(after.to)-Number(before.to))>1){
          throw new Error('1h refresh reset visible range '+JSON.stringify({before,after}));
        }
        const fapi=requests.filter(x=>x.interval);
        if(fapi.length>4)throw new Error('incremental refresh made '+fapi.length+' fapi requests');
        for(const req of fapi){
          if(req.limit>3)throw new Error('incremental limit >3 '+JSON.stringify(req));
          if(req.endTime!=null)throw new Error('incremental request unexpectedly has endTime '+JSON.stringify(req));
        }
        await verifyAxis(page,'1h refreshed');
      }
      await page.close();
    }
    console.log('D2 browser smoke passed: 4h/1h/1d time axis, default view, view preservation, incremental refresh, autoscale, limits and exact axis coordinates.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
