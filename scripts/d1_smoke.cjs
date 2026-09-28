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

async function routeMarket(page,requests,options){
  const opts=options||{};let failed30m=false;
  await page.route(/https:\/\/fapi\.binance\.com\/fapi\/v1\/klines.*/,async route=>{
    const u=new URL(route.request().url()),symbol=u.searchParams.get('symbol'),interval=u.searchParams.get('interval');
    const endRaw=u.searchParams.get('endTime'),end=endRaw==null?Infinity:Number(endRaw);
    const limit=Math.min(1500,Number(u.searchParams.get('limit'))||500);
    requests.push({symbol,interval,limit,endTime:endRaw});
    if(opts.delayMs)await new Promise(resolve=>setTimeout(resolve,opts.delayMs));
    if(opts.failFirst30m&&interval==='30m'&&!failed30m){
      failed30m=true;await route.fulfill({status:500,contentType:'text/plain',body:'synthetic 30m failure'});return;
    }
    const body=rows(symbol,interval).filter(r=>Number(r[0])<=end).slice(-limit);
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
}

async function routeRefreshSeconds(page,seconds){
  await page.route('**/config/analysis-rules.json',async route=>{
    const response=await route.fetch(),body=await response.json();
    body.display.refreshSeconds=seconds;
    await route.fulfill({response,contentType:'application/json',body:JSON.stringify(body)});
  });
}

function exactProfileFixture(symbol){
  const now=new Date(),today=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());
  const day=(new Date(today).getUTCDay()+6)%7,monday=today-day*86400000,previous=monday-7*86400000;
  const expectedDays=Array.from({length:7},(_,i)=>new Date(previous+i*86400000).toISOString().slice(0,10));
  const binSize=symbol==='BTCUSDT'?1:(symbol==='ETHUSDT'?.1:.01);
  const center=Math.round((baseMap[symbol]||100)*.85/binSize);
  return{
    schema:'profiles-v2',symbol,binSize,
    generatedAt:new Date().toISOString(),source:'synthetic smoke fixture',
    profiles:{
      previous:{
        label:expectedDays[0]+' to '+expectedDays[6],expectedDays,days:expectedDays,missingDays:[],failedDays:[],complete:true,
        rows:[[center-2,100,90],[center-1,180,160],[center,300,280],[center+1,170,150],[center+2,90,80]]
      },
      current:{label:'current',expectedDays:[],days:[],missingDays:[],failedDays:[],complete:true,rows:[]}
    }
  };
}

async function failProfileOnce(page){
  let failed=false;
  await page.route(/\/profiles-([A-Z]+)\.json(?:\?.*)?$/,async route=>{
    const m=route.request().url().match(/profiles-([A-Z]+)\.json/),symbol=m&&m[1]||'BTCUSDT';
    if(!failed){failed=true;await route.fulfill({status:404,contentType:'text/plain',body:'synthetic profile miss'});return;}
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(exactProfileFixture(symbol))});
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
    {
      const page=await browser.newPage({viewport:{width:1600,height:1000}});
      const requests=[],network={delayMs:0};await routeRefreshSeconds(page,3);await routeMarket(page,requests,network);
      await page.goto(pageUrl+'?symbol=BTCUSDT&tf=4h',{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>window.__analysisDebug?.model?.symbol==='BTCUSDT'&&document.getElementById('status')?.textContent.startsWith('Loaded '),undefined,{timeout:60000});
      requests.length=0;network.delayMs=1200;
      await page.click('[data-symbol="ETHUSDT"]');
      await page.waitForFunction(()=>window.__analysisDebug?.model?.symbol==='ETHUSDT'&&document.getElementById('status')?.textContent.startsWith('Loaded '),undefined,{timeout:20000});
      await page.waitForFunction(()=>window.__analysisDebug.state.inFlight===null,undefined,{timeout:2000});
      const ethFull=requests.filter(x=>x.symbol==='ETHUSDT'&&x.interval==='1h'&&x.limit===1500);
      if(ethFull.length!==3)throw new Error('D4 slow switch duplicated ETH 1h history pages '+JSON.stringify(ethFull));
      const loadState=await page.evaluate(()=>({token:window.__analysisDebug.state.loadToken,inFlight:!!window.__analysisDebug.state.inFlight,info:document.getElementById('infoLine').textContent}));
      if(loadState.inFlight)throw new Error('D4 slow switch left load in flight '+JSON.stringify(loadState));
      if(!loadState.info.includes('最后刷新'))throw new Error('D4 live title missing last refresh '+loadState.info);
      await page.close();
    }

    {
      const page=await browser.newPage({viewport:{width:1600,height:1000}});
      const requests=[];await routeRefreshSeconds(page,3);await routeMarket(page,requests);
      await page.goto(pageUrl+'?symbol=BTCUSDT&tf=4h',{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
      await page.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,value:true}));
      await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
      requests.length=0;
      await page.waitForTimeout(15500);
      if(requests.length!==0)throw new Error('D4 hidden page refreshed '+JSON.stringify(requests));
      await page.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,value:false}));
      await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
      await page.waitForFunction(()=>window.__analysisDebug.state.inFlight!==null,{timeout:2000}).catch(()=>{});
      await page.waitForTimeout(500);
      if(requests.length<1)throw new Error('D4 foreground did not refresh');
      await page.close();
    }

    {
      const page=await browser.newPage({viewport:{width:1600,height:1000}});
      const requests=[];await routeMarket(page,requests,{failFirst30m:true});
      await page.goto(pageUrl+'?symbol=ETHUSDT&tf=4h',{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
      const missing=await page.evaluate(()=>({
        pmMissing:window.__analysisDebug.model.missing.some(m=>m.type==='价值区 PM'),
        error:window.__analysisDebug.state.bundle.errors['30m'],
        len:(window.__analysisDebug.state.bundle.series['30m']||[]).length
      }));
      if(!missing.pmMissing||!missing.error)throw new Error('D4 30m failure precondition failed '+JSON.stringify(missing));
      await page.evaluate(()=>window.__analysisDebug.refresh());
      await page.waitForFunction(()=>window.__analysisDebug.state.inFlight===null,{timeout:30000});
      const recovered=await page.evaluate(()=>({
        pmMissing:window.__analysisDebug.model.missing.some(m=>m.type==='价值区 PM'),
        error:window.__analysisDebug.state.bundle.errors['30m'],
        len:(window.__analysisDebug.state.bundle.series['30m']||[]).length,
        status:document.getElementById('status').textContent
      }));
      if(recovered.pmMissing||recovered.error||recovered.len<3000||recovered.status.includes('缺失 30m')){
        throw new Error('D4 30m recovery failed '+JSON.stringify(recovered));
      }
      await page.close();
    }

    {
      const page=await browser.newPage({viewport:{width:1600,height:1000}});
      const requests=[];await failProfileOnce(page);await routeMarket(page,requests);
      await page.goto(pageUrl+'?symbol=BTCUSDT&tf=4h',{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
      const before=await page.evaluate(()=>({
        profile:!!window.__analysisDebug.state.bundle.profile,
        error:window.__analysisDebug.state.bundle.errors.profile,
        exactPw:window.__analysisDebug.model.allRegions.some(r=>r.scope==='PW'&&r.source==='exact')
      }));
      if(before.profile||!before.error||before.exactPw)throw new Error('D4 profile failure precondition failed '+JSON.stringify(before));
      await page.evaluate(()=>window.__analysisDebug.refresh());
      await page.waitForFunction(()=>window.__analysisDebug.state.inFlight===null,{timeout:30000});
      const after=await page.evaluate(()=>({
        profile:!!window.__analysisDebug.state.bundle.profile,
        error:window.__analysisDebug.state.bundle.errors.profile,
        exactPw:window.__analysisDebug.model.allRegions.some(r=>r.scope==='PW'&&r.source==='exact')
      }));
      if(!after.profile||after.error||!after.exactPw)throw new Error('D4 profile recovery failed '+JSON.stringify(after));
      await page.close();
    }

    for(const symbol of ['BTCUSDT','ETHUSDT','SOLUSDT']){
      for(const tf of ['4h','1h','1d']){
        const page=await browser.newPage({viewport:{width:1600,height:1000}});
        const requests=[];await routeMarket(page,requests);
        await page.goto(pageUrl+'?symbol='+symbol+'&tf='+tf,{waitUntil:'domcontentloaded',timeout:60000});
        await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
        const labels=await page.evaluate(()=> {
          const d=window.__analysisDebug,gap=Number(d.state.rules.axisLabels.minGapPx),currentY=d.priceCoordinate(d.model.current);
          return{gap,currentY,axis:d.axisLabels().filter(x=>x.visible)};
        });
        for(const row of labels.axis){
          if(Math.abs(Number(row.coordinate)-Number(labels.currentY))<labels.gap){
            throw new Error('D5 latest-price collision '+symbol+' '+tf+' '+JSON.stringify({row,labels}));
          }
        }
        const sorted=labels.axis.slice().sort((a,b)=>Number(a.coordinate)-Number(b.coordinate));
        for(let i=1;i<sorted.length;i++){
          if(Math.abs(Number(sorted[i].coordinate)-Number(sorted[i-1].coordinate))<labels.gap){
            throw new Error('D5 custom-axis collision '+symbol+' '+tf+' '+JSON.stringify(sorted));
          }
        }
        if(symbol==='BTCUSDT'&&tf==='4h'){
          const legend=await page.evaluate(()=>({
            dom:Array.from(document.querySelectorAll('#analysisLegend .legend-item')).map(x=>x.textContent.trim()),
            config:window.__analysisDebug.legend(),
            colors:window.__analysisDebug.state.rules.colors
          }));
          const expected=['PQ 上季价值区','PM 上月价值区','PW 上周价值区','供应区','需求区','本季 VWAP','PQ VWAP','未回补 POC'];
          if(JSON.stringify(legend.dom)!==JSON.stringify(expected))throw new Error('D5 page legend labels '+JSON.stringify(legend));
          const map={pq:'pqBorder',pm:'pmBorder',pw:'pwBorder',supply:'supplyBorder',demand:'demandBorder','current-vwap':'vwap','pq-vwap':'pqVwap',npoc:'nPoc'};
          for(const e of legend.config)if(e.color!==legend.colors[map[e.key]])throw new Error('D5 legend color '+JSON.stringify({e,legend}));
          await page.evaluate(()=>{
            window.__d5ExportLegend=null;
            window.OrderFlowAnalysisExport.exportBoard=async opts=>{window.__d5ExportLegend=opts.legend;return{width:1,height:1};};
          });
          await page.click('#downloadBtn');
          const exported=await page.evaluate(()=>window.__d5ExportLegend);
          if(JSON.stringify(exported)!==JSON.stringify(legend.config))throw new Error('D5 export legend differs '+JSON.stringify({exported,legend:legend.config}));
        }
        await page.close();
      }
    }

    {
      const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true});
      const requests=[];await routeMarket(page,requests);
      await page.goto(pageUrl+'?symbol=ETHUSDT&tf=4h',{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
      const portrait=await page.evaluate(()=> {
        const d=window.__analysisDebug,s=d.state,width=s.chart.timeScale().width(),rules=s.rules;
        const base=Number(rules.display.visibleBars['4h']),ratio=Number(rules.display.rightOffset)/base;
        const fit=Math.floor(width/(Number(rules.display.minBarSpacingPx)*(1+ratio)));
        return{
          spacing:Number(s.chart.timeScale().options().barSpacing),width,visible:d.model.visibleBars,
          expected:Math.max(30,Math.min(base,fit)),
          scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,
          sourceDisplay:getComputedStyle(document.querySelector('th:nth-child(6)')).display,
          calcRight:document.querySelector('th:nth-child(5)').getBoundingClientRect().right,
          info:document.getElementById('infoLine').textContent,lastSuccessAt:s.lastSuccessAt
        };
      });
      if(portrait.spacing<5)throw new Error('D5 portrait bar spacing '+JSON.stringify(portrait));
      if(portrait.scrollWidth!==portrait.clientWidth)throw new Error('D5 portrait horizontal scroll '+JSON.stringify(portrait));
      if(portrait.visible!==portrait.expected||portrait.visible>50)throw new Error('D5 portrait visibleBars '+JSON.stringify(portrait));
      if(portrait.sourceDisplay!=='none'||portrait.calcRight>portrait.clientWidth+.5)throw new Error('D5 mobile table '+JSON.stringify(portrait));
      if(!portrait.info.includes('最后刷新')||Math.abs(Date.now()-Number(portrait.lastSuccessAt))>70000)throw new Error('D4 live refresh time '+JSON.stringify(portrait));

      await page.setViewportSize({width:844,height:390});
      await page.waitForTimeout(1500);
      const landscape=await page.evaluate(()=> {
        const d=window.__analysisDebug,s=d.state,width=s.chart.timeScale().width(),rules=s.rules;
        const base=Number(rules.display.visibleBars['4h']),ratio=Number(rules.display.rightOffset)/base;
        const fit=Math.floor(width/(Number(rules.display.minBarSpacingPx)*(1+ratio)));
        return{spacing:Number(s.chart.timeScale().options().barSpacing),width,visible:d.model.visibleBars,expected:Math.min(base,fit),scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth};
      });
      if(landscape.spacing<5||landscape.spacing>9)throw new Error('D5 landscape bar spacing '+JSON.stringify(landscape));
      if(landscape.visible!==landscape.expected)throw new Error('D5 landscape visibleBars '+JSON.stringify(landscape));
      if(landscape.scrollWidth!==landscape.clientWidth)throw new Error('D5 landscape horizontal scroll '+JSON.stringify(landscape));

      await page.setViewportSize({width:390,height:844});
      await page.waitForTimeout(1500);
      const portraitAgain=await page.evaluate(()=>({spacing:Number(window.__analysisDebug.state.chart.timeScale().options().barSpacing),visible:window.__analysisDebug.model.visibleBars}));
      if(portraitAgain.spacing<5||portraitAgain.visible>50)throw new Error('D5 portrait return '+JSON.stringify(portraitAgain));

      await page.evaluate(()=>{
        const ts=window.__analysisDebug.state.chart.timeScale(),r=ts.getVisibleLogicalRange();
        ts.setVisibleLogicalRange({from:Number(r.from)-8,to:Number(r.to)-8});
      });
      await page.waitForTimeout(150);
      const manualBefore=await page.evaluate(()=>window.__analysisDebug.state.chart.timeScale().getVisibleLogicalRange());
      await page.setViewportSize({width:844,height:390});
      await page.waitForTimeout(1500);
      const manualAfter=await page.evaluate(()=>window.__analysisDebug.state.chart.timeScale().getVisibleLogicalRange());
      if(Math.abs(Number(manualAfter.from)-Number(manualBefore.from))>.5||Math.abs(Number(manualAfter.to)-Number(manualBefore.to))>.5){
        throw new Error('D5 manual view reset on rotate '+JSON.stringify({manualBefore,manualAfter}));
      }
      await page.close();
    }

    {
      const page=await browser.newPage({viewport:{width:1600,height:1000}});
      await page.goto(pageUrl+'?symbol=BTCUSDT&tf=4h&snapshot=1',{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
      const meta=await page.evaluate(()=>({info:document.getElementById('infoLine').textContent,footer:document.getElementById('cutoff').textContent}));
      if(!meta.info.includes('数据截至'))throw new Error('D4 snapshot title missing cutoff '+meta.info);
      const time=meta.info.match(/数据截至 (\d{4}\/\d{2}\/\d{2} \d{2}:\d{2})/);
      if(!time||meta.footer!=='数据截至 '+time[1]+' JST')throw new Error('D5 snapshot cutoff mismatch '+JSON.stringify(meta));
      await page.close();
    }

    console.log('D5 browser smoke passed: rotation settling, latest-price reservation, legend consistency, mobile table and snapshot cutoff.');
    console.log('D4 browser smoke passed: serialized refresh, recovery, mobile window, visibility and refresh-time labels.');
    console.log('D3 browser smoke passed: manual scale preservation, symbol/timeframe reset, price precision, volume autoscale and reset button.');
    console.log('D2 browser smoke passed: 4h/1h/1d time axis, default view, view preservation, incremental refresh, autoscale, limits and exact axis coordinates.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
