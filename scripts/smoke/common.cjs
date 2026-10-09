'use strict';
const {
  intervalSec,baseMap,displayCount,expectedVisible,routeMarket,routeRefreshSeconds,failProfileOnce,
  routeKeyLevels,routePrecomputedAge,routeSnapshotThrough
}=require('./helpers.cjs');

const pageUrl='http://127.0.0.1:8000/analysis.html';

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


const cases=[
  {
    ordinal:4,
    name:'price-axis-and-reset',
    run:async function(browser){
    {
      const page=await browser.newPage({viewport:{width:1600,height:1000}});
      const requests=[];await routeMarket(page,requests);
      await page.goto(pageUrl+'?tpl=combined&view=recent&symbol=BTCUSDT&tf=4h',{waitUntil:'domcontentloaded',timeout:60000});
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
    }
  },
  {
    ordinal:5,
    name:'serialized-refresh',
    run:async function(browser){
    {
      const page=await browser.newPage({viewport:{width:1600,height:1000}});
      const requests=[],network={delayMs:0};await routeRefreshSeconds(page,3);await routeMarket(page,requests,network);
      await page.goto(pageUrl+'?tpl=combined&view=recent&symbol=BTCUSDT&tf=4h',{waitUntil:'domcontentloaded',timeout:60000});
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
    }
  },
  {
    ordinal:6,
    name:'refresh-retry',
    run:async function(browser){
    {
      const page=await browser.newPage({viewport:{width:1600,height:1000}});
      const requests=[];await routeRefreshSeconds(page,3);await routeMarket(page,requests);
      await page.goto(pageUrl+'?tpl=combined&view=recent&symbol=BTCUSDT&tf=4h',{waitUntil:'domcontentloaded',timeout:60000});
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
    }
  },
  {
    ordinal:7,
    name:'responsive-refresh',
    run:async function(browser){
    {
      const page=await browser.newPage({viewport:{width:1600,height:1000}});
      const requests=[];await routeMarket(page,requests,{failFirst30m:true});
      await page.goto(pageUrl+'?tpl=combined&view=recent&symbol=ETHUSDT&tf=4h',{waitUntil:'domcontentloaded',timeout:60000});
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
    }
  },
  {
    ordinal:8,
    name:'mobile-and-visibility',
    run:async function(browser){
    {
      const page=await browser.newPage({viewport:{width:1600,height:1000}});
      const requests=[];await failProfileOnce(page);await routeMarket(page,requests);
      await page.goto(pageUrl+'?tpl=combined&view=recent&symbol=BTCUSDT&tf=4h',{waitUntil:'domcontentloaded',timeout:60000});
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
        await page.goto(pageUrl+'?tpl=combined&view=recent&symbol='+symbol+'&tf='+tf,{waitUntil:'domcontentloaded',timeout:60000});
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
          const expected=['PQ 上季价值区','PM 上月价值区','PW 上周价值区','供应区','需求区','本季 VWAP ±1σ','PQ VWAP','未回补 POC','关键价位'];
          if(JSON.stringify(legend.dom)!==JSON.stringify(expected))throw new Error('D5 page legend labels '+JSON.stringify(legend));
          const map={pq:'pqBorder',pm:'pmBorder',pw:'pwBorder',supply:'supplyBorder',demand:'demandBorder','current-vwap':'vwap','pq-vwap':'pqVwap',npoc:'nPoc','key-level':'keyLevel'};
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
    }
  },
  {
    ordinal:9,
    name:'legend-and-view-rotation',
    run:async function(browser){
    {
      const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true});
      const requests=[];await routeMarket(page,requests);
      await page.goto(pageUrl+'?tpl=combined&view=recent&symbol=ETHUSDT&tf=4h',{waitUntil:'domcontentloaded',timeout:60000});
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
    }
  },
  {
    ordinal:10,
    name:'key-level-parity',
    run:async function(browser){
    {
      const page=await browser.newPage({viewport:{width:1600,height:1000}}),requests=[];
      await routeMarket(page,requests);await routeKeyLevels(page,'fixture');
      await page.goto(pageUrl+'?tpl=combined&symbol=ETHUSDT&tf=1h',{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
      const result=await page.evaluate(()=>{
        const d=window.__analysisDebug,m=d.model,E=window.OrderFlowAnalysisEngine,r=d.state.rules;
        const keys=m.keyLevels||[],pad=Number(r.valueAreas.visiblePadPct);
        return{
          count:keys.length,
          labels:keys.map(x=>x.label),
          sourceIds:keys.map(x=>x.sourceId),
          merged:(m.allLevels||[]).some(x=>x.kind==='key'&&x.label.includes('Q1 VAH')&&x.label.includes('PY Q4 VAH')&&x.label.includes(' · ')),
          inside:keys.every(x=>E.inPriceView(x.price,m.viewMin,m.viewMax,pad)),
          table:Array.from(document.querySelectorAll('#regionRows tr')).map(tr=>tr.textContent)
        };
      });
      if(result.count>6||!result.inside)throw new Error('D10 selected key levels '+JSON.stringify(result));
      if(result.labels.some(x=>x.includes('Q2 VAL')))throw new Error('D10 previous quarter duplicated '+JSON.stringify(result));
      if(!result.merged)throw new Error('D10 near-tick merge missing '+JSON.stringify(result));
      const tableCheck=await page.evaluate(()=>{
        const rows=window.__analysisDebug.model.tableRows,keyRows=rows.filter(x=>x.source==='precomputed'&&!x.summary),summary=rows.find(x=>x.summary);
        return{keyCount:keyRows.length,drawn:(window.__analysisDebug.model.keyLevels||[]).length,summary:summary&&summary.type,offView:keyRows.some(x=>String(x.status).includes('图外'))};
      });
      if(tableCheck.keyCount!==tableCheck.drawn||tableCheck.offView||!tableCheck.summary||!tableCheck.summary.includes('另有 ')){
        throw new Error('D11 compact key-level table '+JSON.stringify(tableCheck));
      }
      await verifyAxis(page,'D10 fixture');
      await page.close();
    }
    }
  },
  {
    ordinal:11,
    name:'key-level-fallback',
    run:async function(browser){
    {
      const page=await browser.newPage({viewport:{width:1600,height:1000}}),requests=[];
      await routeMarket(page,requests);await routeKeyLevels(page,'404');
      await page.goto(pageUrl+'?tpl=combined&view=recent&symbol=ETHUSDT&tf=1h',{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
      const missing=await page.evaluate(()=>({
        levelsError:window.__analysisDebug.state.bundle.errors.levels,
        missing:window.__analysisDebug.model.missing.some(x=>x.type==='关键价位'),
        pq:window.__analysisDebug.model.allRegions.some(x=>x.scope==='PQ')
      }));
      if(!missing.levelsError||!missing.missing||!missing.pq)throw new Error('D10 levels 404 fallback '+JSON.stringify(missing));
      await page.close();
    }
    }
  },
  {
    ordinal:12,
    name:'snapshot-key-levels',
    run:async function(browser){
    {
      const page=await browser.newPage({viewport:{width:1600,height:1000}}),requests=[];
      await routeMarket(page,requests);await routeKeyLevels(page,'fixture');await routeSnapshotThrough(page,'2026-09-30T00:00:00Z');
      await page.goto(pageUrl+'?tpl=combined&symbol=ETHUSDT&tf=1h&snapshot=1',{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
      const q3=await page.evaluate(()=>({
        drawn:(window.__analysisDebug.model.keyLevels||[]).some(x=>x.sourceId==='q3-vah'||x.sourceId==='q3-val'),
        table:(window.__analysisDebug.model.tableRows||[]).some(x=>String(x.type||'').startsWith('Q3 '))
      }));
      if(q3.drawn||q3.table)throw new Error('D11 snapshot rendered unfinished Q3 '+JSON.stringify(q3));
      await page.close();
    }
    }
  },
  {
    ordinal:13,
    name:'archived-combined-view',
    run:async function(browser){
    {
      const page=await browser.newPage({viewport:{width:1600,height:1000}});
      await page.goto(pageUrl+'?tpl=combined&view=recent&symbol=BTCUSDT&tf=4h&snapshot=1',{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
      const meta=await page.evaluate(()=>({info:document.getElementById('infoLine').textContent,footer:document.getElementById('cutoff').textContent}));
      if(!meta.info.includes('数据截至'))throw new Error('D4 snapshot title missing cutoff '+meta.info);
      const time=meta.info.match(/数据截至 (\d{4}\/\d{2}\/\d{2} \d{2}:\d{2})/);
      if(!time||meta.footer!=='数据截至 '+time[1]+' JST')throw new Error('D5 snapshot cutoff mismatch '+JSON.stringify(meta));
      await page.close();
    }
    }
  }
];
module.exports={cases,verifyLimits,verifyAxis,dragPriceAxis,priceState,assertInView,assertBoundaryStable};
