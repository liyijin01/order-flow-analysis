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
    ordinal:14,
    name:'rolling-and-yearly-vwap',
    run:async function(browser){
    {
      const page=await browser.newPage({viewport:{width:1600,height:1000}}),requests=[];
      await routeMarket(page,requests);await routeKeyLevels(page,'fixture');
      await page.goto(pageUrl+'?tpl=rvwap&symbol=BTCUSDT',{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
      const rv=await page.evaluate(()=>{
        const d=window.__analysisDebug,m=d.model,I=window.OrderFlowIndicators,r=d.view().range,span=Number(r.to)-Number(r.from),right=Math.max(0,Number(r.to)-(m.display.length-1));
        const rolling=(m.rvwap&&m.rvwap.rolling)||{},curves=m.curves||[],four=d.state.bundle.series['4h']||[];
        const c30=curves.find(x=>x.id==='rvwap-30'),c365=curves.find(x=>x.id==='rvwap-365'),last30=c30&&c30.points.at(-1);
        const expected30=I.rollingVwap(four,30*86400).at(-1);
        const currentYear=new Date(m.last.time*1000).getUTCFullYear(),ys=Date.UTC(currentYear,0,1)/1000;
        const yExpected=I.anchoredVwap(four.filter(x=>x.time>=ys),ys,1).at(-1);
        const ySeg=(m.rvwap.yearSegments||[]).find(x=>x.year===currentYear),yActual=ySeg&&ySeg.final;
        const first365=c365&&c365.points[0],firstSource=four[0];
        const lineYs=(m.yearLevels||[]).map(x=>d.priceCoordinate(x.price)).filter(Number.isFinite).sort((a,b)=>a-b);
        const gaps=lineYs.map((y,i)=>i?Math.abs(y-lineYs[i-1]):Infinity);
        return{
          template:d.template(),tf:d.state.timeframe,display:m.display.length,days:(m.last.time-m.display[0].time)/86400,
          rightFraction:span>0?right/span:0,rollingLabels:curves.filter(x=>/^rvwap-/.test(x.id)).map(x=>x.label),
          rel30:last30&&expected30&&expected30.value!=null?Math.abs(last30.value-expected30.value)/Math.max(1,Math.abs(expected30.value)):null,
          first365Days:first365&&firstSource?(first365.time-firstSource.time)/86400:null,
          yRel:yActual&&yExpected?Math.abs(yActual.vwap-yExpected.vwap)/Math.max(1,Math.abs(yExpected.vwap)):null,
          regions:m.regions.length,nonYearLevels:m.levels.filter(x=>x.kind!=='year').length,yearLevels:m.yearLevels.length,
          quarterBands:d.state.quarterBands.reduce((n,x)=>n+(x.item&&x.item.points&&x.item.points.length?1:0),0),
          table:getComputedStyle(document.querySelector('.table-wrap')).display,legend:getComputedStyle(document.getElementById('analysisLegend')).display,
          volume:!!d.state.volume,gaps,history:four.length,line2:d.chartInfo().line2
        };
      });
      if(rv.template!=='rvwap'||rv.tf!=='4h'||rv.display!==720||rv.days<119||rv.days>121)throw new Error('D13 rvwap window '+JSON.stringify(rv));
      if(Math.abs(rv.rightFraction-.18)>.025||rv.history<2900)throw new Error('D13 rvwap margin/history '+JSON.stringify(rv));
      if(rv.rollingLabels.length!==4||!rv.rollingLabels.includes('365D RVWAP')||!(rv.rel30<1e-9))throw new Error('D13 rolling lines '+JSON.stringify(rv));
      if(rv.first365Days<365||!(rv.yRel<1e-9))throw new Error('D13 full-window/year VWAP '+JSON.stringify(rv));
      if(rv.regions||rv.nonYearLevels||rv.quarterBands||rv.table!=='none'||rv.legend!=='none'||rv.volume)throw new Error('D13 disabled layers '+JSON.stringify(rv));
      if(rv.gaps.some(x=>x<18)||!rv.line2.includes('Rolling VWAP (hlc3, 4h)'))throw new Error('D13 year levels/info '+JSON.stringify(rv));
      await page.click('[data-tpl="quarter"]');
      await page.waitForFunction(()=>window.__analysisDebug?.template()==='quarter'&&String(window.__analysisDebug?.state?.viewKey||'').includes('|quarter|')&&document.getElementById('status')?.textContent.startsWith('Loaded '),undefined,{timeout:60000});
      const q=await page.evaluate(()=>({year:(window.__analysisDebug.model.yearLevels||[]).length,template:window.__analysisDebug.template()}));
      if(q.template!=='quarter'||q.year)throw new Error('D13 quarter restore/year exclusion '+JSON.stringify(q));
      await page.click('[data-tpl="combined"]');
      await page.waitForFunction(()=>window.__analysisDebug?.template()==='combined'&&document.getElementById('status')?.textContent.startsWith('Loaded '),undefined,{timeout:60000});
      const cb=await page.evaluate(()=>({year:(window.__analysisDebug.model.yearLevels||[]).length,template:window.__analysisDebug.template()}));
      if(cb.template!=='combined'||cb.year)throw new Error('D13 combined restore/year exclusion '+JSON.stringify(cb));
      await page.close();
    }
    }
  }
];
module.exports={cases};
