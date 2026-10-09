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
    ordinal:16,
    name:'monthly-structure',
    run:async function(browser){
    {
      const page=await browser.newPage({viewport:{width:1600,height:1000}}),requests=[];
      await routeMarket(page,requests);await routeKeyLevels(page,'fixture');
      await page.goto(pageUrl+'?tpl=monthly&symbol=BTCUSDT',{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
      const m=await page.evaluate(()=>{
        const d=window.__analysisDebug,model=d.model,r=d.view().range,span=Number(r.to)-Number(r.from),right=Math.max(0,Number(r.to)-(model.display.length-1)),mm=model.monthly||{};
        const tfButtons=Array.from(document.querySelectorAll('[data-tf]')).map(b=>({tf:b.dataset.tf,display:getComputedStyle(b).display,disabled:b.disabled}));
        return{template:d.template(),tf:d.state.timeframe,display:model.display.length,rightFraction:span>0?right/span:0,upper:mm.upper,lower:mm.lower,imbalance:mm.imbalance,
          regions:model.regions.map(x=>({scope:x.scope,bottom:x.bottom,top:x.top,label:x.label})),levels:model.levels.map(x=>({kind:x.kind,label:x.label,month:x.month,price:x.price})),
          curves:(model.curves||[]).length,table:getComputedStyle(document.querySelector('.table-wrap')).display,legend:getComputedStyle(document.getElementById('analysisLegend')).display,
          volume:!!d.state.volume,quarterBands:d.state.quarterBands.reduce((n,x)=>n+(x.item&&x.item.points&&x.item.points.length?1:0),0),tfButtons,line2:d.chartInfo().line2,watermark:d.chartInfo().watermark};
      });
      if(m.template!=='monthly'||m.tf!=='1M'||m.display!==12)throw new Error('D15 monthly window '+JSON.stringify(m));
      if(Math.abs(m.rightFraction-.18)>.025)throw new Error('D15 monthly right margin '+JSON.stringify(m));
      if(m.levels.length>2||m.levels.some(x=>x.kind!=='monthly-sr'||!(x.label==='S/R'||/^[A-Z][a-z]{2} \d{4} [HL]$/.test(x.label))))throw new Error('D15 monthly S/R '+JSON.stringify(m));
      if(m.regions.length>1||m.regions.some(x=>x.scope!=='MONTHLY_IMBALANCE'||x.label!=='imbalance'))throw new Error('D15 monthly imbalance '+JSON.stringify(m));
      if(m.curves||m.table!=='none'||m.legend!=='none'||m.volume||m.quarterBands)throw new Error('D15 disabled layers '+JSON.stringify(m));
      if(!m.upper||m.upper.month!=='2026-01'||!m.lower||m.lower.month!=='2026-05'||!m.imbalance||m.imbalance.c1Month!=='2026-08'||m.imbalance.c3Month!=='2026-10')throw new Error('D15 fixture selection '+JSON.stringify(m));
      if(!m.tfButtons.find(x=>x.tf==='1M'||false)||m.tfButtons.find(x=>x.tf==='1M').display==='none'||m.tfButtons.some(x=>x.tf!=='1M'&&x.display!=='none')||!m.line2.includes('Monthly structure')||!m.watermark.includes('1月'))throw new Error('D15 chrome/info '+JSON.stringify(m));
      for(const symbol of ['ETHUSDT','SOLUSDT','BTCUSDT']){
        await page.click('[data-symbol="'+symbol+'"]');await page.waitForFunction(s=>window.__analysisDebug?.state.symbol===s&&window.__analysisDebug?.state.timeframe==='1M'&&document.getElementById('status')?.textContent.startsWith('Loaded '),symbol,{timeout:60000});
        const ok=await page.evaluate(()=>window.__analysisDebug?.template()==='monthly'&&window.__analysisDebug?.model?.display?.length===12);
        if(!ok)throw new Error('D15 monthly symbol switch '+symbol);
      }
      for(const tpl of ['quarter','rvwap','weekly','combined']){
        await page.click('[data-tpl="'+tpl+'"]');await page.waitForFunction(t=>window.__analysisDebug?.template()===t&&document.getElementById('status')?.textContent.startsWith('Loaded '),tpl,{timeout:60000});
        const visible1M=await page.evaluate(()=>getComputedStyle(document.querySelector('[data-tf="1M"]')).display!=='none');
        if(visible1M)throw new Error('D15 1M visible outside monthly '+tpl);
      }
      await page.close();
    }
    }
  }
];
module.exports={cases};
