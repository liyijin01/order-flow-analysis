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
    ordinal:18,
    name:'monthly-tpo-profile',
    run:async function(browser){
    {
      const page=await browser.newPage({viewport:{width:1600,height:1000}});
      await page.goto(pageUrl+'?tpl=mprofile&symbol=BTCUSDT&snapshot=1',{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
      const mp=await page.evaluate(()=>{
        const d=window.__analysisDebug,m=d.model,E=window.OrderFlowAnalysisEngine,r=d.view().range,span=Number(r.to)-Number(r.from),right=Math.max(0,Number(r.to)-(m.display.length-1)),model=m.mprofile||{},pre=(d.state.bundle.tpo&&d.state.bundle.tpo.monthly)||[];
        const ended=(model.profiles||[]).filter(x=>!x.forming),current=(model.profiles||[]).find(x=>x.forming),thirty=d.state.bundle.series['30m']||[],start=E.utcMonthStart(m.last.time),bars=thirty.filter(x=>Number(x.time)>=start),expected=bars.length?E.tpoProfile(bars,(Number((window.ORDER_FLOW_SYMBOLS||{}).BTCUSDT.tickSize)||.1)*100):null;
        let endedOk=ended.length===11;for(const p of ended){const src=pre.find(x=>Date.parse(x.start)/1000===Number(p.start));endedOk=endedOk&&!!src&&Number(src.vah)===Number(p.vah)&&Number(src.val)===Number(p.val)&&Number(src.poc)===Number(p.poc);}
        const currentOk=!!current&&!!expected&&Number(current.vah)===Number(expected.vah)&&Number(current.val)===Number(expected.val)&&Number(current.poc)===Number(expected.poc);
        const ext=new Map((model.extensions||[]).map(x=>[String(x.from)+'-'+x.side,x])),lines=(m.levels||[]).filter(x=>x.kind==='mprofile'),stopsOk=lines.filter(x=>!x.current&&!x.naked).every(x=>{const e=ext.get(String(x.from)+'-'+x.side);return e&&Number(x.to)===Number(e.to);});
        const style=d.candleStyle(),tfButtons=Array.from(document.querySelectorAll('[data-tf]')).map(b=>({tf:b.dataset.tf,text:b.textContent,display:getComputedStyle(b).display}));
        const touchedLines=lines.filter(x=>!x.naked&&!x.current),currentTouched=lines.filter(x=>x.naked&&x.touchedThisPeriod),pw=model.priceWindow||{},pane=d.mainPaneHeight(),top=d.state.candles.coordinateToPrice(0),bottom=d.state.candles.coordinateToPrice(pane);
        return{template:d.template(),tf:d.state.timeframe,profiles:(model.profiles||[]).length,endedOk,currentOk,stopsOk,box:model.box?1:0,
          touchedLines:touchedLines.length,currentTouched:currentTouched.map(x=>({style:x.style,axisColor:x.axisColor})),priceWindow:pw,top,bottom,currentLow:current&&current.low,currentHigh:current&&current.high,
          rightFraction:span>0?right/span:0,regions:m.regions.map(x=>x.scope||x.type),levels:m.levels.map(x=>x.kind),curves:(m.curves||[]).length,
          table:getComputedStyle(document.querySelector('.table-wrap')).display,legend:getComputedStyle(document.getElementById('analysisLegend')).display,volume:!!d.state.volume,
          quarterBands:d.state.quarterBands.reduce((n,x)=>n+(x.item&&x.item.points&&x.item.points.length?1:0),0),countdown:d.chartInfo().countdown,style,tfButtons,
          watermark:d.chartInfo().watermark,line2:d.chartInfo().line2,tpoError:d.state.bundle.errors.tpo||null};
      });
      if(mp.template!=='mprofile'||mp.tf!=='1d'||mp.profiles!==12||!mp.endedOk||!mp.currentOk)throw new Error('D16 mprofile data '+JSON.stringify(mp));
      if(Math.abs(mp.rightFraction-.30)>.025||!mp.stopsOk||mp.box>1)throw new Error('D16 mprofile layout '+JSON.stringify(mp));
      if(mp.touchedLines>8||mp.currentTouched.some(x=>x.style!=='dashed'||!String(x.axisColor).startsWith('rgba(')))throw new Error('D18 mprofile touched lines '+JSON.stringify(mp));
      if(!(mp.bottom<=mp.priceWindow.min&&mp.top>=mp.priceWindow.max&&mp.currentLow>=mp.priceWindow.min&&mp.currentHigh<=mp.priceWindow.max))throw new Error('D18 mprofile price window '+JSON.stringify(mp));
      if(mp.regions.some(x=>!['MPROFILE_BOX','SINGLE_PRINT'].includes(x))||mp.levels.some(x=>x!=='mprofile')||mp.curves||mp.table!=='none'||mp.legend!=='none'||mp.volume||mp.quarterBands||mp.countdown)throw new Error('D16 mprofile disabled layers '+JSON.stringify(mp));
      if(mp.style.upColor!=='rgba(0,0,0,0)'||mp.style.borderUpColor!=='rgba(0,0,0,0)'||mp.style.wickUpColor!=='rgba(0,0,0,0)'||mp.style.priceLineVisible!==true)throw new Error('D16 hidden candles '+JSON.stringify(mp.style));
      if(!mp.tfButtons.find(x=>x.tf==='1d'&&x.text==='M30'&&x.display!=='none')||mp.tfButtons.some(x=>x.tf!=='1d'&&x.display!=='none')||!mp.watermark.includes('M30 Monthly')||!mp.line2.includes('Monthly TPO (30m, 70%)')||mp.tpoError)throw new Error('D16 mprofile chrome '+JSON.stringify(mp));
      for(const symbol of ['ETHUSDT','SOLUSDT','BTCUSDT']){
        await page.evaluate(s=>document.querySelector('[data-symbol="'+s+'"]')?.click(),symbol);await page.waitForFunction(s=>window.__analysisDebug?.state.symbol===s&&window.__analysisDebug?.template()==='mprofile'&&document.getElementById('status')?.textContent.startsWith('Loaded '),symbol,{timeout:60000});
        const ok=await page.evaluate(()=>window.__analysisDebug?.model?.mprofile?.profiles?.length===12);
        if(!ok)throw new Error('D16 mprofile symbol switch '+symbol);
      }
      await page.evaluate(()=>document.querySelector('[data-tpl="monthly"]')?.click());await page.waitForFunction(()=>window.__analysisDebug?.template()==='monthly'&&document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
      const restored=await page.evaluate(()=>({visible1M:getComputedStyle(document.querySelector('[data-tf="1M"]')).display!=='none',text1d:document.querySelector('[data-tf="1d"]').textContent}));
      if(!restored.visible1M||restored.text1d!=='1D')throw new Error('D16 template restore '+JSON.stringify(restored));
      await page.close();
    }
    }
  }
];
module.exports={cases};
