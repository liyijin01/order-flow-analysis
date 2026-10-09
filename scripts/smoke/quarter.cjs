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
    ordinal:0,
    name:'default-quarter-and-switch',
    run:async function(browser){
    {
      const page=await browser.newPage({viewport:{width:1600,height:1000}}),requests=[];
      await routeMarket(page,requests);await routeKeyLevels(page,'fixture');
      await page.goto(pageUrl+'?symbol=ETHUSDT',{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
      const q=await page.evaluate(()=>{
        const d=window.__analysisDebug,m=d.model,r=d.view().range,style=d.candleStyle(),pq=m.levels.filter(x=>x.kind==='pq-bound'),span=Number(r.to)-Number(r.from),right=Math.max(0,Number(r.to)-(m.display.length-1));
        return{
          template:d.template(),tf:d.state.timeframe,display:m.display.length,days:(m.last.time-m.display[0].time)/86400,rightFraction:span>0?right/span:0,
          regions:m.regions.map(x=>x.scope||x.type),npoc:m.levels.some(x=>x.kind==='npoc'),pq:pq.map(x=>({label:x.label,style:x.style,axisLabel:x.axisLabel,color:x.color})),
          keyCount:(m.keyLevels||[]).length,keyWhiteDashed:(m.keyLevels||[]).every(x=>x.style==='dashed'&&x.color===d.state.rules.templates.quarter.keyLevelStyle.color),
          tableRows:m.tableRows.length,tableDisplay:getComputedStyle(document.querySelector('.table-wrap')).display,legendDisplay:getComputedStyle(document.getElementById('analysisLegend')).display,
          volumeAbsent:d.state.volume===null,upColor:style.upColor,downColor:style.downColor,watermarkColor:d.chartInfo().watermarkColor
        };
      });
      if(q.template!=='quarter'||q.tf!=='1h')throw new Error('D12 default template '+JSON.stringify(q));
      if(q.display!==720||q.days<29||q.days>31)throw new Error('D12 1h 30-day window '+JSON.stringify(q));
      if(Math.abs(q.rightFraction-.18)>.025)throw new Error('D12 right margin '+JSON.stringify(q));
      if(q.regions.length||q.npoc||q.tableRows||q.tableDisplay!=='none'||q.legendDisplay!=='none'||!q.volumeAbsent)throw new Error('D12 disabled layers '+JSON.stringify(q));
      if(q.pq.length!==2||q.pq.some(x=>x.style!=='dashed'||x.axisLabel!==true)||q.keyCount>6||!q.keyWhiteDashed)throw new Error('D12 quarter lines '+JSON.stringify(q));
      const gaps=await page.evaluate(()=>{
        const d=window.__analysisDebug,m=d.model;
        const rows=(m.levels||[]).filter(x=>x.kind==='key'||x.kind==='pq'||x.kind==='pq-bound').map(x=>({id:x.id,y:d.state.candles.priceToCoordinate(x.price)})).filter(x=>Number.isFinite(Number(x.y))).sort((a,b)=>a.y-b.y);
        return rows.map((x,i)=>i?Math.abs(Number(x.y)-Number(rows[i-1].y)):Infinity);
      });
      if(gaps.some(x=>x<18))throw new Error('D12b quarter horizontal-line gap '+JSON.stringify(gaps));
      await page.evaluate(()=>{window.__analysisDebug.model.last.closeTime=Date.now()+65000;});
      await page.waitForTimeout(1100);
      await page.waitForFunction(()=>window.__analysisDebug.axisLabels().some(x=>x.id==='countdown'),undefined,{timeout:5000});
      const axisCheck=await page.evaluate(()=>{
        const d=window.__analysisDebug,axis=d.axisLabels(),countdown=axis.find(x=>x.id==='countdown'),currentY=d.state.candles.priceToCoordinate(d.model.current);
        const others=axis.filter(x=>x.visible&&x.id!=='countdown'),key=others.find(x=>String(x.id).startsWith('key-'));
        return{countdown,currentY,others,key,domText:document.getElementById('closeCountdown').textContent,domDisplay:getComputedStyle(document.getElementById('closeCountdown')).display};
      });
      if(!axisCheck.countdown||!(Number(axisCheck.countdown.coordinate)>Number(axisCheck.currentY)))throw new Error('D12b countdown axis position '+JSON.stringify(axisCheck));
      if(axisCheck.others.some(x=>Math.abs(Number(x.coordinate)-Number(axisCheck.countdown.coordinate))<14))throw new Error('D12b countdown axis collision '+JSON.stringify(axisCheck));
      if(axisCheck.domText||axisCheck.domDisplay!=='none')throw new Error('D12b DOM countdown still visible '+JSON.stringify(axisCheck));
      if(!axisCheck.key||axisCheck.key.color!=='#3a4152'||axisCheck.key.textColor!=='#eceff4')throw new Error('D12b key price-axis style '+JSON.stringify(axisCheck));
      if(q.upColor!=='#e6e9ef'||q.downColor!=='rgba(0,0,0,0)'||q.watermarkColor!=='rgba(196,140,60,.30)')throw new Error('D12 global style '+JSON.stringify(q));
      await page.click('[data-tpl="combined"]');
      await page.waitForFunction(()=>window.__analysisDebug?.template()==='combined'&&String(window.__analysisDebug?.state?.viewKey||'').includes('|combined|')&&document.getElementById('status')?.textContent.startsWith('Loaded '),undefined,{timeout:60000});
      const combined=await page.evaluate(()=>({table:getComputedStyle(document.querySelector('.table-wrap')).display,legend:getComputedStyle(document.getElementById('analysisLegend')).display,volume:!!window.__analysisDebug.state.volume}));
      if(combined.table==='none'||combined.legend==='none'||!combined.volume)throw new Error('D12 combined restore '+JSON.stringify(combined));
      await page.close();
    }
    }
  },
  {
    ordinal:19,
    name:'stale-precomputed-data',
    run:async function(browser){
    {
      const page=await browser.newPage({viewport:{width:1600,height:1000}}),requests=[];
      await routeMarket(page,requests);const age=await routePrecomputedAge(page,40);
      await page.goto(pageUrl+'?tpl=quarter&symbol=BTCUSDT',{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
      let stale=await page.locator('#staleData').textContent();
      if(!/预计算数据已 40 小时未更新/.test(stale))throw new Error('D18 stale warning missing: '+stale);
      age.hours=0;await page.evaluate(()=>window.__analysisDebug.refresh(true));
      await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded ')&&!document.getElementById('staleData')?.textContent,{timeout:60000});
      stale=await page.locator('#staleData').textContent();
      if(stale)throw new Error('D18 fresh warning did not clear: '+stale);
      await page.close();
    }
    }
  }
];
module.exports={cases};
