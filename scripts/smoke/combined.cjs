'use strict';
const {
  intervalSec,baseMap,displayCount,expectedVisible,routeMarket,routeRefreshSeconds,failProfileOnce,
  routeKeyLevels,routePrecomputedAge,routeSnapshotThrough
}=require('./helpers.cjs');
const {
  verifyLimits,verifyAxis,dragPriceAxis,priceState,assertInView,assertBoundaryStable
}=require('./common.cjs');

const pageUrl='http://127.0.0.1:8000/analysis.html';

const cases=[
  {
    ordinal:1,
    name:'quarter-window-timeframes',
    run:async function(browser){
    for(const tf of ['4h','1h','1d']){
      const page=await browser.newPage({viewport:{width:1600,height:1000}}),requests=[];await routeMarket(page,requests);
      await page.goto(pageUrl+'?tpl=combined&symbol=ETHUSDT&tf='+tf,{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
      const q=await page.evaluate(tf=>{
        const d=window.__analysisDebug,m=d.model,E=window.OrderFlowAnalysisEngine,I=window.OrderFlowIndicators,D=window.OrderFlowAnalysisData;
        const start=E.previousQuarterStart(m.last.time),set=new Set(m.display.map(x=>x.time)),bands=m.quarterVwaps;
        let maxRel=0;
        for(const seg of bands){
          const dd=new Date(seg.start*1000),end=Date.UTC(dd.getUTCFullYear(),dd.getUTCMonth()+3,1)/1000;
          const raw=I.anchoredVwap((d.state.bundle.series['1h']||[]).filter(b=>b.time>=seg.start&&b.time<end),seg.start,1);
          const map=new Map(raw.map(x=>[x.time,x]));
          if(tf==='1h')for(const p of seg.points){const x=map.get(p.time);if(x)maxRel=Math.max(maxRel,Math.abs(p.vwap-x.vwap)/Math.max(1,Math.abs(x.vwap)));}
        }
        const cur=bands.find(x=>x.start===E.utcQuarterStart(m.last.time)),first=cur&&cur.points[0],bar=(d.state.bundle.series['1h']||[]).find(x=>x.time===cur?.start);
        const hlc3=bar?(Number(bar.high)+Number(bar.low)+Number(bar.close))/3:null;
        return{start,firstTime:m.display[0].time,count:m.display.length,slots:d.view().logicalSlots,allBandTimes:bands.flatMap(x=>x.points.map(p=>p.time)).every(t=>set.has(t)),maxRel,firstVwap:first&&first.vwap,hlc3,view:d.viewMode(),watermark:d.chartInfo().watermark,line2:d.chartInfo().line2};
      },tf);
      if(q.view!=='quarter'||Math.abs(q.firstTime-q.start)>intervalSec[tf])throw new Error('D9 quarter start '+tf+' '+JSON.stringify(q));
      if(Math.abs(q.slots-q.count*1.04)>2)throw new Error('D9 quarter span '+tf+' '+JSON.stringify(q));
      if(!q.allBandTimes)throw new Error('D9 band introduced non-display time '+tf);
      if(tf==='1h'&&(!(q.maxRel<1e-9)||Math.abs(q.firstVwap-q.hlc3)/Math.max(1,Math.abs(q.hlc3))>=1e-9))throw new Error('D9 AVWAP parity '+JSON.stringify(q));
      const expectedWatermark='ETHUSDT.P, '+(({'1h':'1小时','4h':'4小时','1d':'1天'})[tf]||tf);
      if(q.watermark!==expectedWatermark||!q.line2.includes('Anchored VWAP (hlc3, Quarter, ±1σ)'))throw new Error('D9 overlay '+tf+' '+JSON.stringify(q));
      if(tf==='1h'){
        const target=await page.evaluate(()=>window.__analysisDebug.model.display[Math.floor(window.__analysisDebug.model.display.length*.7)]);
        const box=await page.locator('#analysisChart').boundingBox();
        const pos=await page.evaluate(t=>({x:window.__analysisDebug.state.chart.timeScale().timeToCoordinate(window.OrderFlowAnalysisData.toDisplayTime(t.time)),y:window.__analysisDebug.state.candles.priceToCoordinate(t.close)}),target);
        await page.mouse.move(box.x+pos.x,box.y+pos.y);await page.waitForTimeout(100);
        const line=await page.evaluate(()=>window.__analysisDebug.chartInfo().line1);
        if(!line.includes('开='+Number(target.open).toLocaleString())&&!line.includes('开='))throw new Error('D9 crosshair OHLC '+line);
      }
      await page.evaluate(()=>{window.__analysisDebug.model.last.closeTime=Date.now()+65000;});
      await page.waitForTimeout(1100);
      const countdown=await page.evaluate(()=>window.__analysisDebug.chartInfo().countdown);
      if(!/\d{2}:\d{2}(?::\d{2})?$/.test(countdown))throw new Error('D9 live countdown '+countdown);
      await page.close();
    }
    }
  },
  {
    ordinal:2,
    name:'archived-snapshot',
    run:async function(browser){
    {
      const page=await browser.newPage({viewport:{width:1600,height:1000}});
      await page.goto(pageUrl+'?tpl=combined&snapshot=1&symbol=ETHUSDT&tf=1h',{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
      if(await page.evaluate(()=>window.__analysisDebug.chartInfo().countdown))throw new Error('D9 snapshot countdown should be absent');
      await page.close();
    }
    }
  },
  {
    ordinal:3,
    name:'recent-mode-timeframes',
    run:async function(browser){
    for(const tf of ['4h','1h','1d']){
      const page=await browser.newPage({viewport:{width:1600,height:1000}});
      const requests=[];await routeMarket(page,requests);
      await page.goto(pageUrl+'?tpl=combined&view=recent&symbol=ETHUSDT&tf='+tf,{waitUntil:'domcontentloaded',timeout:60000});
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
    }
  },
  {
    ordinal:20,
    name:'new-quarter-table-cap',
    run:async function(browser){
    {
      const page=await browser.newPage({viewport:{width:1600,height:1000}}),requests=[];
      await routeMarket(page,requests);await routeKeyLevels(page,'fixture');await routeSnapshotThrough(page,'2026-10-02T00:00:00Z');
      await page.goto(pageUrl+'?tpl=combined&symbol=ETHUSDT&tf=1h&snapshot=1',{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
      const rows=await page.evaluate(()=>window.__analysisDebug.model.tableRows.length);
      if(rows>16)throw new Error('D12b new-quarter table exceeded 16 rows: '+rows);
      await page.close();
    }
    }
  }
];
module.exports={cases};
