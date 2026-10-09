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
    ordinal:15,
    name:'weekly-vwap-projections',
    run:async function(browser){
    {
      const page=await browser.newPage({viewport:{width:1600,height:1000}}),requests=[];
      await routeMarket(page,requests);await routeKeyLevels(page,'fixture');
      await page.goto(pageUrl+'?tpl=weekly&symbol=BTCUSDT',{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
      const w=await page.evaluate(()=>{
        const d=window.__analysisDebug,m=d.model,I=window.OrderFlowIndicators,r=d.view().range,span=Number(r.to)-Number(r.from),right=Math.max(0,Number(r.to)-(m.display.length-1)),thirty=d.state.bundle.series['30m']||[];
        const segs=(m.weekly&&m.weekly.segments)||[],lastSeg=segs.find(x=>Number(m.last.time)>=Number(x.start)&&Number(m.last.time)<Number(x.end)),expected=lastSeg?I.anchoredVwap(thirty.filter(b=>Number(b.time)>=Number(lastSeg.start)&&Number(b.time)<Number(lastSeg.end)),lastSeg.start,1).find(x=>Number(x.time)===Number(m.last.time)):null;
        const actual=lastSeg&&lastSeg.points.find(x=>Number(x.time)===Number(m.last.time)),projs=(m.weekly&&m.weekly.projections)||[];
        let projOk=true;for(const p of projs){const cur=segs.find(x=>Number(x.start)===Number(p.weekStart)),prev=(m.weekly&&m.weekly.segments||[]).find(x=>Number(x.start)===Number(p.weekStart)-7*86400);if(prev&&prev.complete){const f=prev.final;projOk=projOk&&Math.abs(Number(p.pwVwap)-Number(f.vwap))<1e-9&&Math.abs(Number(p.pwUpper)-Number(f.upper))<1e-9&&Math.abs(Number(p.pwLower)-Number(f.lower))<1e-9;}}
        const tfButtons=Array.from(document.querySelectorAll('[data-tf]')).map(b=>({tf:b.dataset.tf,display:getComputedStyle(b).display,disabled:b.disabled}));
        return{template:d.template(),tf:d.state.timeframe,display:m.display.length,days:(m.last.time-m.display[0].time)/86400,rightFraction:span>0?right/span:0,segments:segs.map(x=>x.start),rel:actual&&expected?Math.abs(actual.vwap-expected.vwap)/Math.max(1,Math.abs(expected.vwap)):null,projOk,regions:m.regions.map(x=>x.scope||x.type),levels:m.levels.map(x=>x.kind),curves:m.curves.map(x=>x.id),table:getComputedStyle(document.querySelector('.table-wrap')).display,legend:getComputedStyle(document.getElementById('analysisLegend')).display,volume:!!d.state.volume,quarterBands:d.state.quarterBands.reduce((n,x)=>n+(x.item&&x.item.points&&x.item.points.length?1:0),0),tfButtons,line2:d.chartInfo().line2};
      });
      if(w.template!=='weekly'||w.tf!=='30m'||w.display!==1152||w.days<23.5||w.days>24.5)throw new Error('D14 weekly window '+JSON.stringify(w));
      if(Math.abs(w.rightFraction-.18)>.025||!(w.rel<1e-9)||!w.projOk)throw new Error('D14 weekly values '+JSON.stringify(w));
      if(w.segments.some(t=>{const d=new Date(Number(t)*1000);return d.getUTCDay()!==1||d.getUTCHours()!==0||d.getUTCMinutes()!==0;}))throw new Error('D14 weekly anchors '+JSON.stringify(w));
      if(w.regions.some(x=>x!=='WEEKLY_PROJECTION')||w.levels.some(x=>!['weekly','weekly-pw','year-open'].includes(x))||w.curves.some(x=>!/^weekly-/.test(x))||w.table!=='none'||w.legend!=='none'||w.volume||w.quarterBands)throw new Error('D14 disabled layers '+JSON.stringify(w));
      if(!w.tfButtons.find(x=>x.tf==='30m'||false)||w.tfButtons.find(x=>x.tf==='30m').display==='none'||w.tfButtons.some(x=>x.tf!=='30m'&&x.display!=='none')||!w.line2.includes('Weekly VWAP (hlc3, 30m, ±1σ)'))throw new Error('D14 chrome/info '+JSON.stringify(w));
      for(const tpl of ['quarter','rvwap','combined']){
        await page.click('[data-tpl="'+tpl+'"]');await page.waitForFunction(t=>window.__analysisDebug?.template()===t&&document.getElementById('status')?.textContent.startsWith('Loaded '),tpl,{timeout:60000});
        const visible30=await page.evaluate(()=>getComputedStyle(document.querySelector('[data-tf="30m"]')).display!=='none');
        if(visible30)throw new Error('D14 30m visible outside weekly '+tpl);
      }
      await page.close();
    }
    }
  }
];
module.exports={cases};
