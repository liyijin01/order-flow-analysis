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
    ordinal:17,
    name:'weekly-tpo-profile',
    run:async function(browser){
    {
      const page=await browser.newPage({viewport:{width:1600,height:1000}});
      await page.goto(pageUrl+'?tpl=wprofile&symbol=BTCUSDT&snapshot=1',{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
      const wp=await page.evaluate(()=>{
        const d=window.__analysisDebug,m=d.model,r=d.view().range,span=Number(r.to)-Number(r.from),right=Math.max(0,Number(r.to)-(m.display.length-1)),model=m.wprofile||{},pre=(d.state.bundle.tpo&&d.state.bundle.tpo.weekly)||[],style=d.candleStyle();
        const ended=(model.profiles||[]).filter(x=>!x.forming),current=(model.profiles||[]).find(x=>x.forming),naked=(model.naked||[]),sp=(model.singlePrints||[]);
        let endedOk=ended.length===25;for(const p of ended){const src=pre.find(x=>Date.parse(x.start)/1000===Number(p.start));endedOk=endedOk&&!!src&&Number(src.vah)===Number(p.vah)&&Number(src.val)===Number(p.val)&&Number(src.poc)===Number(p.poc);}
        const tfButtons=Array.from(document.querySelectorAll('[data-tf]')).map(b=>({tf:b.dataset.tf,text:b.textContent,display:getComputedStyle(b).display}));
        const touchedLines=(m.levels||[]).filter(x=>x.kind==='wprofile'&&!x.naked&&!x.current),currentTouched=(m.levels||[]).filter(x=>x.kind==='wprofile'&&x.naked&&x.touchedThisPeriod),pw=model.priceWindow||{};
        const pane=d.mainPaneHeight(),top=d.state.candles.coordinateToPrice(0),bottom=d.state.candles.coordinateToPrice(pane);
        return{template:d.template(),tf:d.state.timeframe,profiles:(model.profiles||[]).length,endedOk,current:!!current,naked:naked.length,nakedLabels:(m.levels||[]).filter(x=>x.kind==='wprofile'&&x.naked).map(x=>x.label),reference:model.reference?1:0,sp:sp.length,
          touchedLines:touchedLines.length,currentTouched:currentTouched.map(x=>({style:x.style,axisColor:x.axisColor})),priceWindow:pw,top,bottom,currentLow:current&&current.low,currentHigh:current&&current.high,
          rightFraction:span>0?right/span:0,regions:m.regions.map(x=>x.scope||x.type),levels:m.levels.map(x=>x.kind),table:getComputedStyle(document.querySelector('.table-wrap')).display,legend:getComputedStyle(document.getElementById('analysisLegend')).display,volume:!!d.state.volume,
          quarterBands:d.state.quarterBands.reduce((n,x)=>n+(x.item&&x.item.points&&x.item.points.length?1:0),0),countdown:d.chartInfo().countdown,style,tfButtons,watermark:d.chartInfo().watermark,line2:d.chartInfo().line2,tpoError:d.state.bundle.errors.tpo||null};
      });
      if(wp.template!=='wprofile'||wp.tf!=='1d'||wp.profiles!==26||!wp.endedOk||!wp.current)throw new Error('D17 wprofile data '+JSON.stringify(wp));
      if(Math.abs(wp.rightFraction-.30)>.025||wp.naked>16||wp.nakedLabels.some(Boolean)||wp.reference>1||wp.sp>6)throw new Error('D17 wprofile layout '+JSON.stringify(wp));
      if(wp.touchedLines>8||wp.currentTouched.some(x=>x.style!=='dashed'||!String(x.axisColor).startsWith('rgba(')))throw new Error('D18 wprofile touched lines '+JSON.stringify(wp));
      if(!(wp.bottom<=wp.priceWindow.min&&wp.top>=wp.priceWindow.max&&wp.currentLow>=wp.priceWindow.min&&wp.currentHigh<=wp.priceWindow.max))throw new Error('D18 wprofile price window '+JSON.stringify(wp));
      if(wp.regions.some(x=>!['WPROFILE_REF','SINGLE_PRINT'].includes(x))||wp.levels.some(x=>x!=='wprofile')||wp.table!=='none'||wp.legend!=='none'||wp.volume||wp.quarterBands||wp.countdown)throw new Error('D17 wprofile disabled layers '+JSON.stringify(wp));
      if(wp.style.upColor!=='rgba(0,0,0,0)'||wp.style.priceLineVisible!==true)throw new Error('D17 hidden candles '+JSON.stringify(wp.style));
      if(!wp.tfButtons.find(x=>x.tf==='1d'&&x.text==='M30'&&x.display!=='none')||wp.tfButtons.some(x=>x.tf!=='1d'&&x.display!=='none')||!wp.watermark.includes('M30 Weekly')||!wp.line2.includes('Weekly TPO (30m, 70%)')||!wp.line2.includes('SP ')||wp.tpoError)throw new Error('D17 wprofile chrome '+JSON.stringify(wp));
      for(const symbol of ['ETHUSDT','SOLUSDT','BTCUSDT']){
        await page.evaluate(s=>document.querySelector('[data-symbol="'+s+'"]')?.click(),symbol);await page.waitForFunction(s=>window.__analysisDebug?.state.symbol===s&&window.__analysisDebug?.template()==='wprofile'&&document.getElementById('status')?.textContent.startsWith('Loaded '),symbol,{timeout:60000});
        const ok=await page.evaluate(()=>window.__analysisDebug?.model?.wprofile?.profiles?.length===26);
        if(!ok)throw new Error('D17 wprofile symbol switch '+symbol);
      }
      await page.evaluate(()=>document.querySelector('[data-tpl="mprofile"]')?.click());await page.waitForFunction(()=>window.__analysisDebug?.template()==='mprofile'&&document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
      const mp=await page.evaluate(()=>({sp:(window.__analysisDebug.model?.mprofile?.singlePrints||[]).length,line2:window.__analysisDebug.chartInfo().line2}));
      if(mp.sp>6||!mp.line2.includes('SP '))throw new Error('D17 mprofile single prints '+JSON.stringify(mp));
      await page.close();
    }
    }
  }
];
module.exports={cases};
