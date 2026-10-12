'use strict';
const fs=require('fs');
const path=require('path');
const {routeMarket}=require('./helpers.cjs');
const base='http://127.0.0.1:8000/';
const outDir=path.resolve('d20c-fallback');

function recordScreenshot(page,name){
  fs.mkdirSync(outDir,{recursive:true});
  return page.screenshot({path:path.join(outDir,name),fullPage:true});
}
async function loadedInFallback(page){
  await page.waitForFunction(()=>{
    const el=document.getElementById('fallbackBanner'),state=window.__analysisDebug?.state||window.__flowDebug?.state;
    return el&&!el.hidden&&state?.fallback===true&&state?.snapshot===true&&
      document.getElementById('status')?.textContent.startsWith('Loaded ');
  },undefined,{timeout:20000});
}
async function waitForLive(page,debug){
  await page.waitForFunction(key=>{
    const state=window[key]?.state;
    return state&&state.fallback===false&&state.snapshot===false&&
      state.bundle?.schema?.includes('live')&&
      document.getElementById('fallbackBanner')?.hidden===true&&
      document.getElementById('status')?.textContent.startsWith('Loaded ');
  },debug,{timeout:45000});
}
async function liveProbe(page,isAvailable){
  await page.route(/https:\/\/fapi\.binance\.com\/fapi\/v1\/time(?:\?.*)?$/,async route=>{
    const reply=isAvailable();
    await route.fulfill({
      status:reply?200:451,
      contentType:'application/json',
      headers:reply?{'access-control-allow-origin':'*'}:{},
      body:reply?'{"serverTime":1791780000000}':'{"code":-1003}'
    });
  });
}
function analysisSignature(){
  const model=window.__analysisDebug.model;
  return JSON.stringify({
    display:model.display,calcLastClosedUtc:model.calcLastClosedUtc,
    current:model.current,last:model.last,
    quarterVwaps:model.quarterVwaps,pqStats:model.pqStats,
    currentVwap:model.currentVwap
  });
}
function flowSignature(){
  const model=window.__flowDebug.model;
  return JSON.stringify({
    display:model.display,current:model.current,
    perp:model.perp,spot:model.spot,avwap:model.avwap,
    anchor:model.anchor
  });
}
const rowsCache=new Map();
function flowRows(symbol,interval){
  const key=symbol+'|'+interval;
  if(rowsCache.has(key))return rowsCache.get(key);
  const step=interval==='1h'?3600:900,base=symbol==='BTCUSDT'?82000:symbol==='ETHUSDT'?2700:120;
  const end=Math.floor(Date.now()/1000/step)*step,count=interval==='1h'?2500:2600,start=end-step*(count-1);
  const out=[];
  for(let i=0;i<count;i++){
    const ms=(start+i*step)*1000,open=base*(1+Math.sin(i/37)*.02),close=open+Math.sin(i/11)*base*.003;
    const high=Math.max(open,close)+base*.003,low=Math.min(open,close)-base*.003,vol=1000+i%67;
    out.push([ms,String(open),String(high),String(low),String(close),String(vol),
      ms+step*1000-1,String(vol*close),100,String(vol*.5),String(vol*close*.5),'0']);
  }
  rowsCache.set(key,out);
  return out;
}

const cases=[
  {
    ordinal:24,
    name:'analysis-fapi-451-fallback-and-recovery',
    run:async browser=>{
      const page=await browser.newPage({viewport:{width:1600,height:1000}});
      let available=false,blocked=0;
      try{
        await routeMarket(page,[]);
        await page.route(/https:\/\/fapi\.binance\.com\/fapi\/v1\/klines.*/,async route=>{
          if(available)return route.fallback();
          blocked++;
          return route.fulfill({status:451,body:'restricted location'});
        });
        await liveProbe(page,()=>available);
        const begin=Date.now();
        await page.goto(base+'analysis.html?tpl=quarter&tf=1h&symbol=BTCUSDT',{
          waitUntil:'domcontentloaded',timeout:60000});
        await loadedInFallback(page);
        const elapsed=Date.now()-begin;
        if(elapsed>3000)throw new Error('Analysis fallback exceeded 3s: '+elapsed+'ms');
        if(blocked>2)throw new Error('Analysis excessive fapi attempts: '+blocked);
        const banner=await page.locator('#fallbackBanner').innerText();
        if(!banner.includes('实时数据不可用')||!banner.includes('数据截至')||
          !banner.includes('重试实时'))throw new Error('Analysis fallback banner incomplete');
        const digest=await page.evaluate(analysisSignature);
        await recordScreenshot(page,'analysis-fallback.png');
        const explicit=await browser.newPage({viewport:{width:1600,height:1000}});
        try{
          await explicit.goto(base+'analysis.html?snapshot=1&tpl=quarter&tf=1h&symbol=BTCUSDT',{
            waitUntil:'domcontentloaded',timeout:60000});
          await explicit.waitForFunction(()=>window.__analysisDebug?.model&&
            document.getElementById('status')?.textContent.startsWith('Loaded '),undefined,{timeout:20000});
          const expected=await explicit.evaluate(analysisSignature);
          if(digest!==expected)throw new Error('Analysis fallback values differ from explicit snapshot');
        }finally{await explicit.close();}
        const before=blocked;
        await page.click('[data-symbol="ETHUSDT"]');
        await page.waitForFunction(()=>window.__analysisDebug?.state?.symbol==='ETHUSDT'&&
          document.getElementById('status')?.textContent.startsWith('Loaded '),undefined,{timeout:20000});
        if(blocked!==before)throw new Error('Analysis symbol switch retried blocked fapi');
        available=true;
        await page.click('#fallbackBanner button');
        await waitForLive(page,'__analysisDebug');
        if((await page.locator('#fallbackBanner').isVisible()))throw new Error('Analysis banner remains after recovery');
        if(blocked>2)throw new Error('Analysis blocked request count changed: '+blocked);
        console.log('D20c analysis fallback elapsedMs='+elapsed+' blockedFapi='+blocked+
          ' symbolSwitchExtraFapi='+(blocked-before)+' restored=true');
      }finally{await page.close();}
    }
  },
  {
    ordinal:25,
    name:'flow-fapi-451-fallback-and-recovery',
    run:async browser=>{
      const page=await browser.newPage({viewport:{width:1600,height:1100}});
      let available=false,fapiBlocked=0;
      try{
        await page.route(/https:\/\/(?:fapi\.binance\.com\/fapi\/v1|api\.binance\.com\/api\/v3)\/klines.*/,async route=>{
          const u=new URL(route.request().url()),fapi=u.hostname==='fapi.binance.com';
          if(!available){
            if(fapi)fapiBlocked++;
            return route.fulfill({status:451,body:'restricted location'});
          }
          const symbol=u.searchParams.get('symbol')||'BTCUSDT',interval=u.searchParams.get('interval')||'15m';
          const start=u.searchParams.has('startTime')?Number(u.searchParams.get('startTime')):-Infinity;
          const end=u.searchParams.has('endTime')?Number(u.searchParams.get('endTime')):Infinity;
          const limit=Number(u.searchParams.get('limit'))||500;
          const matching=flowRows(symbol,interval).filter(row=>row[0]>=start&&row[0]<=end);
          const selected=u.searchParams.has('startTime')?matching.slice(0,limit):matching.slice(-limit);
          return route.fulfill({status:200,contentType:'application/json',
            headers:{'access-control-allow-origin':'*'},body:JSON.stringify(selected)});
        });
        await liveProbe(page,()=>available);
        const started=Date.now();
        await page.goto(base+'flow.html?symbol=BTCUSDT&tf=15m&anchor=swing',{
          waitUntil:'domcontentloaded',timeout:60000});
        await loadedInFallback(page);
        const elapsed=Date.now()-started;
        if(elapsed>3000)throw new Error('Flow fallback exceeded 3s: '+elapsed+'ms');
        if(fapiBlocked>4)throw new Error('Flow excessive fapi attempts: '+fapiBlocked);
        const snapshotDigest=await page.evaluate(flowSignature);
        await recordScreenshot(page,'flow-fallback.png');
        // Snapshot-only CSS uses a wider chart than the normal flow page.
        // CVD is anchored to the visible window; compare at identical chart widths.
        const fallbackWidth=await page.locator('#flowChart').evaluate(el=>el.clientWidth);
        const explicit=await browser.newPage({viewport:{width:fallbackWidth+20,height:1100}});
        try{
          await explicit.goto(base+'flow.html?snapshot=1&symbol=BTCUSDT&tf=15m&anchor=swing',{
            waitUntil:'domcontentloaded',timeout:60000});
          await explicit.waitForFunction(()=>window.__flowDebug?.model&&
            document.getElementById('status')?.textContent.startsWith('Loaded '),undefined,{timeout:20000});
          const explicitWidth=await explicit.locator('#flowChart').evaluate(el=>el.clientWidth);
          if(explicitWidth!==fallbackWidth){
            throw new Error('Flow snapshot chart widths differ: fallback='+
              fallbackWidth+' explicit='+explicitWidth);
          }
          const expected=await explicit.evaluate(flowSignature);
          if(snapshotDigest!==expected){
            const actual=JSON.parse(snapshotDigest),baseline=JSON.parse(expected);
            const changed=Object.keys(actual).filter(key=>
              JSON.stringify(actual[key])!==JSON.stringify(baseline[key]));
            throw new Error('Flow fallback values differ from explicit snapshot: '+changed.join(','));
          }
        }finally{await explicit.close();}
        const before=fapiBlocked;
        await page.click('[data-symbol="ETHUSDT"]');
        await page.waitForFunction(()=>window.__flowDebug?.state?.symbol==='ETHUSDT'&&
          document.getElementById('status')?.textContent.startsWith('Loaded '),undefined,{timeout:20000});
        if(fapiBlocked!==before)throw new Error('Flow symbol switch retried blocked fapi');
        available=true;
        await page.click('#fallbackBanner button');
        await waitForLive(page,'__flowDebug');
        console.log('D20c flow fallback elapsedMs='+elapsed+' blockedFapi='+fapiBlocked+
          ' symbolSwitchExtraFapi='+(fapiBlocked-before)+' restored=true');
      }finally{await page.close();}
    }
  }
];
module.exports={cases:[cases[0]],flowFallback:cases[1]};
