const {chromium}=require('playwright-core');

const pageUrl='http://127.0.0.1:8000/flow.html';
const intervalSec={15:900,30:1800,60:3600};
const baseMap={BTCUSDT:82000,ETHUSDT:2700,SOLUSDT:120};
const cache=new Map();

function marketRows(symbol,interval){
  const key=symbol+'|'+interval;if(cache.has(key))return cache.get(key);
  const sec=interval==='1h'?3600:interval==='30m'?1800:900,base=baseMap[symbol]||100,count=interval==='1h'?2300:2300;
  const end=Math.floor(Date.now()/1000/sec)*sec,start=end-sec*(count-1),out=[];
  for(let i=0;i<count;i++){
    const t=start+i*sec,wave=Math.sin(i/37)*base*.035+Math.cos(i/83)*base*.018,open=base+wave,delta=Math.sin(i/11)*base*.003,close=open+delta;
    const high=Math.max(open,close)+base*.003,low=Math.min(open,close)-base*.003,vol=1000+(i%47)*17,quote=vol*close,buyQuote=quote*(delta>=0?.62:.38);
    out.push([t*1000,open.toFixed(8),high.toFixed(8),low.toFixed(8),close.toFixed(8),vol.toFixed(4),t*1000+sec*1000-1,quote.toFixed(4),100,(vol*.5).toFixed(4),buyQuote.toFixed(4),'0']);
  }
  cache.set(key,out);return out;
}

async function routeMarket(page,requests,opts={}){
  let spotFailed=false;
  await page.route(/https:\/\/(?:fapi\.binance\.com\/fapi\/v1\/klines|api\.binance\.com\/api\/v3\/klines).*/,async route=>{
    const u=new URL(route.request().url()),symbol=u.searchParams.get('symbol'),interval=u.searchParams.get('interval')||'15m',limit=Number(u.searchParams.get('limit'))||500;
    const spot=u.hostname==='api.binance.com',endRaw=u.searchParams.get('endTime'),end=endRaw==null?Infinity:Number(endRaw);
    requests.push({symbol,interval,spot,limit,endTime:endRaw});
    if(opts.delaySymbol===symbol)await new Promise(r=>setTimeout(r,opts.delayMs||900));
    if(opts.failFirstSpot&&spot&&!spotFailed){spotFailed=true;await route.fulfill({status:500,body:'synthetic spot failure'});return;}
    const body=marketRows(symbol,interval).filter(r=>Number(r[0])<=end).slice(-limit);
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
}
async function routeRefreshSeconds(page,seconds){
  await page.route('**/config/flow-rules.json',async route=>{
    const response=await route.fetch(),body=await response.json();body.display.refreshSeconds=seconds;
    await route.fulfill({response,contentType:'application/json',body:JSON.stringify(body)});
  });
}
function assertSubset(meta,label){
  const allowed=new Set(meta.price);
  for(const [name,times] of Object.entries(meta))if(name!=='price'){
    if(!times.every(t=>allowed.has(t)))throw new Error(label+' '+name+' introduced non-display time');
  }
}
function assertPaneRatios(meta,label){
  const total=meta.paneHeights.reduce((a,b)=>a+Number(b),0);
  if(!(total>0))throw new Error(label+' pane height total '+total);
  for(let i=0;i<meta.paneHeights.length;i++){
    const actual=100*Number(meta.paneHeights[i])/total,expected=100*Number(meta.paneRatios[i]);
    if(Math.abs(actual-expected)>2)throw new Error(label+' pane ratio '+i+' actual='+actual.toFixed(2)+' expected='+expected.toFixed(2));
  }
}
function assertCvdConsistency(meta,label){
  const perp=meta.tableRows.find(r=>r[0]==='CVD'&&r[1]==='Binance Perp');
  const spot=meta.tableRows.find(r=>r[0]==='CVD'&&r[1]==='Binance Spot');
  if(!perp||!spot)throw new Error(label+' missing CVD table rows '+JSON.stringify(meta.tableRows));
  const pv=perp[2].split(' · ')[0],sv=spot[2].split(' · ')[0];
  if(!meta.labels[1].includes('Perpetuals '+pv+' ·')||!meta.labels[1].endsWith('from '+perp[3]))throw new Error(label+' perp CVD label/table mismatch '+JSON.stringify({label:meta.labels[1],row:perp}));
  if(!meta.labels[2].includes('Spot '+sv+' ·')||!meta.labels[2].endsWith('from '+spot[3]))throw new Error(label+' spot CVD label/table mismatch '+JSON.stringify({label:meta.labels[2],row:spot}));
}

(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    for(const symbol of ['BTCUSDT','ETHUSDT','SOLUSDT']){
      for(const tf of ['15m','30m']){
        const page=await browser.newPage({viewport:{width:1600,height:1200}});
        await page.goto(pageUrl+'?snapshot=1&anchor=swing&symbol='+symbol+'&tf='+tf,{waitUntil:'domcontentloaded',timeout:60000});
        await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),undefined,{timeout:60000});
        const meta=await page.evaluate(()=>{
          const d=window.__flowDebug,s=d.state,m=d.model,n=m.visibleBars,bars=m.display.slice(-n),pane=s.chart.panes()[0],h=pane.getHeight();
          let lo=Infinity,hi=-Infinity;for(const b of bars){lo=Math.min(lo,Number(b.low));hi=Math.max(hi,Number(b.high));}
          const paneRules=s.rules.panes,labels=Array.from(document.querySelectorAll('.pane-label')).map(x=>x.textContent);
          return{
            panes:d.paneCount(),times:d.seriesTimes(),avwap:m.avwap.map(x=>x.time),
            autos:[s.candles,s.perpCvd,s.spotCvd,s.depthDelta[0],s.depthDelta[1],s.depthDelta[2]].map(x=>x.priceScale().options().autoScale),
            paneHeight:h,yLow:s.candles.priceToCoordinate(lo),yHigh:s.candles.priceToCoordinate(hi),
            paneHeights:s.chart.panes().map(x=>x.getHeight()),paneRatios:[paneRules.price,paneRules.perpCvd,paneRules.spotCvd,paneRules.depth1,paneRules.depth2,paneRules.depth3],
            priceFormats:[s.perpCvd,s.spotCvd,s.depthDelta[0],s.depthDelta[1],s.depthDelta[2]].map(x=>x.options().priceFormat&&x.options().priceFormat.type),
            visible:m.visibleBars,range:d.view().range,anchor:m.anchor,buckets:m.buckets,
            cvdAnchorTime:m.cvdAnchorTime,expectedCvdAnchor:m.display[Math.max(0,m.display.length-m.visibleBars)].time,
            labels,tableRows:Array.from(document.querySelectorAll('#flowRows tr')).map(tr=>Array.from(tr.children).map(td=>td.textContent)),
            depthCutoffTextCount:labels.filter(x=>x.includes('depth archive through ')).length
          };
        });
        if(meta.panes!==6)throw new Error(symbol+' '+tf+' pane count '+meta.panes);
        assertSubset({...meta.times,avwap:meta.avwap},symbol+' '+tf);
        assertPaneRatios(meta,symbol+' '+tf);
        assertCvdConsistency(meta,symbol+' '+tf);
        if(meta.priceFormats.some(x=>x!=='custom'))throw new Error(symbol+' '+tf+' secondary price formats '+JSON.stringify(meta.priceFormats));
        if(meta.depthCutoffTextCount!==1)throw new Error(symbol+' '+tf+' depth cutoff text count '+meta.depthCutoffTextCount);
        if(meta.autos.some(x=>x!==true))throw new Error(symbol+' '+tf+' independent autoscale '+JSON.stringify(meta.autos));
        const occupied=Math.abs(Number(meta.yLow)-Number(meta.yHigh));
        if(!(occupied>=.6*Number(meta.paneHeight)))throw new Error(symbol+' '+tf+' price occupancy '+occupied+'/'+meta.paneHeight);
        if(meta.labels.length!==6)throw new Error(symbol+' '+tf+' pane labels '+meta.labels.length);
        if(meta.cvdAnchorTime!==meta.expectedCvdAnchor)throw new Error(symbol+' '+tf+' CVD anchor '+JSON.stringify({actual:meta.cvdAnchorTime,expected:meta.expectedCvdAnchor}));
        if(!meta.labels[0].includes('Binance USD-M')||!meta.labels[0].includes('anchor '))throw new Error(symbol+' '+tf+' price pane label incomplete '+meta.labels[0]);
        if(!meta.labels[1].includes('Binance Perp')||!meta.labels[1].includes('from '))throw new Error(symbol+' '+tf+' perp CVD label incomplete '+meta.labels[1]);
        if(!meta.labels[2].includes('Binance Spot')||!meta.labels[2].includes('from '))throw new Error(symbol+' '+tf+' spot CVD label incomplete '+meta.labels[2]);
        for(const label of meta.labels.slice(3))if(!label.includes('Binance USD-M book'))throw new Error(symbol+' '+tf+' depth label incomplete '+label);
        if(!meta.labels[3].includes('depth archive through ')||meta.labels[4].includes('depth archive through ')||meta.labels[5].includes('depth archive through '))throw new Error(symbol+' '+tf+' depth cutoff label placement '+JSON.stringify(meta.labels.slice(3)));
        if(JSON.stringify(meta.buckets)!==JSON.stringify([[0,1],[1,2],[2,5]]))throw new Error('bucket labels/config mismatch');
        if(tf==='30m'&&meta.avwap.some(t=>!new Set(meta.times.price).has(t)))throw new Error('30m AVWAP logical time leak');
        await page.close();
      }
    }

    {
      const page=await browser.newPage({viewport:{width:1600,height:1100}});
      await page.goto(pageUrl+'?snapshot=1&symbol=BTCUSDT&tf=15m&anchor=swing',{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),undefined,{timeout:60000});
      await page.evaluate(()=>{const e=document.getElementById('anchorMode');e.value='week';e.dispatchEvent(new Event('change',{bubbles:true}));});
      await page.waitForFunction(()=>window.__flowDebug?.model?.anchor?.mode==='week'&&document.getElementById('status')?.textContent.startsWith('Loaded '),undefined,{timeout:60000});
      await page.evaluate(()=>{const e=document.getElementById('anchorMode');e.value='quarter';e.dispatchEvent(new Event('change',{bubbles:true}));});
      await page.waitForFunction(()=>window.__flowDebug?.model?.anchor?.mode==='quarter'&&document.getElementById('status')?.textContent.startsWith('Loaded '),undefined,{timeout:60000});
      await page.evaluate(()=>document.querySelector('[data-tf="30m"]').click());
      await page.waitForFunction(()=>window.__flowDebug?.model?.timeframe==='30m'&&document.getElementById('status')?.textContent.startsWith('Loaded '),undefined,{timeout:60000});
      await page.evaluate(()=>document.querySelector('[data-symbol="ETHUSDT"]').click());
      await page.waitForFunction(()=>window.__flowDebug?.model?.symbol==='ETHUSDT'&&document.getElementById('status')?.textContent.startsWith('Loaded '),undefined,{timeout:60000});
      const anchor=await page.evaluate(()=>new Date(window.__flowDebug.model.display[Math.max(0,window.__flowDebug.model.display.length-20)].time*1000).toISOString());
      await page.goto(pageUrl+'?snapshot=1&symbol=ETHUSDT&tf=15m&anchor=manual&avwapAnchor='+encodeURIComponent(anchor),{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>window.__flowDebug?.model?.anchor?.mode==='manual'&&document.getElementById('status')?.textContent.startsWith('Loaded '),undefined,{timeout:60000});
      await page.close();
    }

    {
      const page=await browser.newPage({viewport:{width:1600,height:1000}});
      const requests=[];await routeMarket(page,requests,{delaySymbol:'ETHUSDT',delayMs:1200});
      await page.goto(pageUrl+'?symbol=BTCUSDT&tf=15m&anchor=swing',{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>window.__flowDebug?.model?.symbol==='BTCUSDT'&&document.getElementById('status')?.textContent.startsWith('Loaded '),undefined,{timeout:60000});
      await page.click('[data-symbol="ETHUSDT"]');await page.waitForTimeout(100);await page.click('[data-symbol="SOLUSDT"]');
      await page.waitForFunction(()=>window.__flowDebug?.model?.symbol==='SOLUSDT'&&document.getElementById('status')?.textContent.startsWith('Loaded '),undefined,{timeout:60000});
      if(await page.evaluate(()=>window.__flowDebug.state.inFlight!==null))throw new Error('slow switch left request in flight');
      await page.close();
    }

    {
      const page=await browser.newPage({viewport:{width:1600,height:1000}});
      const requests=[];await routeRefreshSeconds(page,3);await routeMarket(page,requests,{failFirstSpot:true});
      await page.goto(pageUrl+'?symbol=BTCUSDT&tf=15m&anchor=swing',{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),undefined,{timeout:60000});
      const failed=await page.evaluate(()=>({error:window.__flowDebug.state.bundle.errors.spot15m,matched:window.__flowDebug.model.spot.matched}));
      if(!failed.error||failed.matched!==0)throw new Error('spot failure precondition '+JSON.stringify(failed));
      await page.evaluate(()=>window.__flowDebug.refresh());
      await page.waitForFunction(()=>window.__flowDebug.state.inFlight===null,{timeout:30000});
      const recovered=await page.evaluate(()=>({error:window.__flowDebug.state.bundle.errors.spot15m,matched:window.__flowDebug.model.spot.matched}));
      if(recovered.error||recovered.matched<100)throw new Error('spot recovery failed '+JSON.stringify(recovered));

      await page.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,value:true}));
      await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));requests.length=0;
      await page.waitForTimeout(7000);if(requests.length)throw new Error('hidden flow board refreshed '+JSON.stringify(requests));
      await page.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,value:false}));
      await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
      await page.waitForTimeout(700);if(requests.length<2)throw new Error('foreground flow refresh missing '+JSON.stringify(requests));
      await page.close();
    }

    {
      const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true});
      await page.goto(pageUrl+'?snapshot=1&symbol=BTCUSDT&tf=15m&anchor=swing',{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),undefined,{timeout:60000});
      const portrait=await page.evaluate(()=>{
        const d=window.__flowDebug,s=d.state,m=d.model,p=s.rules.panes,labels=Array.from(document.querySelectorAll('.pane-label')).map(x=>x.textContent);
        return{spacing:Number(s.chart.timeScale().options().barSpacing),visible:m.visibleBars,cvdAnchor:m.cvdAnchorTime,expected:m.display[Math.max(0,m.display.length-m.visibleBars)].time,scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,
          paneHeights:s.chart.panes().map(x=>x.getHeight()),paneRatios:[p.price,p.perpCvd,p.spotCvd,p.depth1,p.depth2,p.depth3],
          labels,tableRows:Array.from(document.querySelectorAll('#flowRows tr')).map(tr=>Array.from(tr.children).map(td=>td.textContent)),
          depthCutoffTextCount:labels.filter(x=>x.includes('depth archive through ')).length};
      });
      if(portrait.spacing<5||portrait.scrollWidth!==portrait.clientWidth||portrait.visible>56||portrait.cvdAnchor!==portrait.expected)throw new Error('flow portrait '+JSON.stringify(portrait));
      assertPaneRatios(portrait,'flow portrait');assertCvdConsistency(portrait,'flow portrait');
      if(portrait.depthCutoffTextCount!==1)throw new Error('flow portrait depth cutoff text count '+portrait.depthCutoffTextCount);
      await page.setViewportSize({width:844,height:390});await page.waitForTimeout(1500);
      const landscape=await page.evaluate(()=>({spacing:Number(window.__flowDebug.state.chart.timeScale().options().barSpacing),visible:window.__flowDebug.model.visibleBars,scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}));
      if(landscape.spacing<5||landscape.scrollWidth!==landscape.clientWidth)throw new Error('flow landscape '+JSON.stringify(landscape));
      await page.setViewportSize({width:390,height:844});await page.waitForTimeout(1500);
      const again=await page.evaluate(()=>({spacing:Number(window.__flowDebug.state.chart.timeScale().options().barSpacing),visible:window.__flowDebug.model.visibleBars,cvdAnchor:window.__flowDebug.model.cvdAnchorTime,expected:window.__flowDebug.model.display[Math.max(0,window.__flowDebug.model.display.length-window.__flowDebug.model.visibleBars)].time}));
      if(again.spacing<5||again.visible>56||again.cvdAnchor!==again.expected)throw new Error('flow portrait return '+JSON.stringify(again));
      await page.evaluate(()=>window.__flowDebug.resetView());await page.waitForTimeout(200);
      const reset=await page.evaluate(()=>({cvdAnchor:window.__flowDebug.model.cvdAnchorTime,expected:window.__flowDebug.model.display[Math.max(0,window.__flowDebug.model.display.length-window.__flowDebug.model.visibleBars)].time}));
      if(reset.cvdAnchor!==reset.expected)throw new Error('flow reset did not re-anchor CVD '+JSON.stringify(reset));
      await page.evaluate(()=>{window.__d6Export=null;window.OrderFlowAnalysisExport.exportFlowBoard=async o=>{window.__d6Export=o;return{width:1,height:1};};});
      await page.evaluate(()=>document.getElementById('downloadBtn').click());
      const exp=await page.evaluate(()=>window.__d6Export&&({labels:window.__d6Export.paneLabels.length,rows:window.__d6Export.rows.length}));
      if(!exp||exp.labels!==6||exp.rows<7)throw new Error('flow export missing panes/labels '+JSON.stringify(exp));
      await page.close();
    }

    console.log('D6 browser smoke passed: six panes, AVWAP/CVD/depth, switching, abort, hidden/recovery, mobile and export.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
