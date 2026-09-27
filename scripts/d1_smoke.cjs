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

async function dragPriceAxis(page,pane){
  const box=await page.locator('#analysisChart').boundingBox();
  if(!box)throw new Error('analysisChart bounding box missing');
  const x=box.x+box.width-30;
  const y=pane==='volume'?box.y+box.height-55:box.y+Math.min(280,box.height*.35);
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x,y+80,{steps:8});
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function priceState(page){
  return page.evaluate(()=> {
    const d=window.__analysisDebug,s=d.state,h=d.mainPaneHeight();
    return{
      candleAuto:s.candles.priceScale().options().autoScale,
      volumeAuto:s.volume.priceScale().options().autoScale,
      top:s.candles.coordinateToPrice(0),
      bottom:s.candles.coordinateToPrice(h),
      paneHeight:h,
      viewMin:d.model.viewMin,
      viewMax:d.model.viewMax,
      format:s.candles.options().priceFormat,
      range:s.chart.timeScale().getVisibleLogicalRange(),
      visibleBars:d.model.visibleBars
    };
  });
}

function assertInView(v,label){
  if(!(Number(v.top)>=Number(v.viewMax)&&Number(v.bottom)<=Number(v.viewMin))){
    throw new Error(label+' candles not in view '+JSON.stringify(v));
  }
}

function assertBoundaryStable(before,after,label){
  for(const k of ['top','bottom']){
    const base=Math.max(1,Math.abs(Number(before[k])));
    const pct=Math.abs(Number(after[k])-Number(before[k]))/base;
    if(pct>.005)throw new Error(label+' '+k+' changed '+(pct*100).toFixed(3)+'% '+JSON.stringify({before,after}));
  }
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
        throw new Error(tf+' visible price range occupies only '+occupied+' of pane '+first.paneHeight+' '+JSON.stringify({viewMin:first.model.viewMin,viewMax:first.model.viewMax,regions:first.model.regions.map(r=>({id:r.id,type:r.type,bottom:r.bottom,top:r.top})),levels:first.model.levels.map(l=>({id:l.id,price:l.price})),vwap:first.model.currentVwap.slice(-3)}));
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
    {
      const page=await browser.newPage({viewport:{width:1600,height:1000}});
      const requests=[];await routeMarket(page,requests);
      await page.goto(pageUrl+'?symbol=BTCUSDT&tf=4h',{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});

      await dragPriceAxis(page,'main');
      let btc=await priceState(page);
      if(btc.candleAuto!==false)throw new Error('D3 main price drag did not disable autoScale');

      requests.length=0;
      await page.evaluate(()=>window.__analysisDebug.refresh());
      await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded ')||document.getElementById('status')?.textContent.startsWith('刷新失败'),{timeout:30000});
      const refreshed=await priceState(page);
      if(refreshed.candleAuto!==false)throw new Error('D3 same-view refresh re-enabled autoScale');
      assertBoundaryStable(btc,refreshed,'D3 same-view refresh');

      await page.click('[data-symbol="ETHUSDT"]');
      await page.waitForFunction(()=>window.__analysisDebug?.model?.symbol==='ETHUSDT'&&document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
      const eth=await priceState(page);
      if(eth.candleAuto!==true||eth.volumeAuto!==true)throw new Error('D3 ETH switch did not restore autoScale '+JSON.stringify(eth));
      assertInView(eth,'D3 ETH');
      if(Number(eth.format.precision)!==2||Math.abs(Number(eth.format.minMove)-.01)>1e-12)throw new Error('D3 ETH priceFormat '+JSON.stringify(eth.format));

      await page.click('[data-symbol="SOLUSDT"]');
      await page.waitForFunction(()=>window.__analysisDebug?.model?.symbol==='SOLUSDT'&&document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
      let sol=await priceState(page);
      if(sol.candleAuto!==true||sol.volumeAuto!==true)throw new Error('D3 SOL switch did not restore autoScale '+JSON.stringify(sol));
      assertInView(sol,'D3 SOL');
      if(Number(sol.format.precision)!==3||Math.abs(Number(sol.format.minMove)-.001)>1e-12)throw new Error('D3 SOL priceFormat '+JSON.stringify(sol.format));

      await dragPriceAxis(page,'main');
      sol=await priceState(page);
      if(sol.candleAuto!==false)throw new Error('D3 SOL price drag did not disable autoScale');
      await page.click('[data-tf="1d"]');
      await page.waitForFunction(()=>window.__analysisDebug?.model?.timeframe==='1d'&&document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
      const sol1d=await priceState(page);
      if(sol1d.candleAuto!==true)throw new Error('D3 timeframe switch did not restore main autoScale');
      assertInView(sol1d,'D3 SOL 1D');

      await dragPriceAxis(page,'volume');
      const volumeDragged=await priceState(page);
      if(volumeDragged.volumeAuto!==false)throw new Error('D3 volume price drag did not disable autoScale');
      await page.click('[data-symbol="BTCUSDT"]');
      await page.waitForFunction(()=>window.__analysisDebug?.model?.symbol==='BTCUSDT'&&document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
      const volumeReset=await priceState(page);
      if(volumeReset.volumeAuto!==true)throw new Error('D3 symbol switch did not restore volume autoScale');

      await dragPriceAxis(page,'main');
      await page.evaluate(()=>window.__analysisDebug.state.chart.timeScale().setVisibleLogicalRange({from:40,to:90}));
      await page.waitForTimeout(100);
      const changed=await priceState(page);
      if(changed.candleAuto!==false)throw new Error('D3 reset precondition autoScale not false');
      await page.click('#resetViewBtn');
      await page.waitForTimeout(150);
      const reset=await priceState(page);
      if(reset.candleAuto!==true||reset.volumeAuto!==true)throw new Error('D3 reset button did not restore autoScale '+JSON.stringify(reset));
      const slots=Number(reset.range.to)-Number(reset.range.from);
      const expected=Number(reset.visibleBars)+30;
      if(Math.abs(slots-expected)>2)throw new Error('D3 reset time span '+slots+' expected '+expected);

      await page.close();
    }
    console.log('D3 browser smoke passed: manual scale preservation, symbol/timeframe reset, price precision, volume autoscale and reset button.');
    console.log('D2 browser smoke passed: 4h/1h/1d time axis, default view, view preservation, incremental refresh, autoscale, limits and exact axis coordinates.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
