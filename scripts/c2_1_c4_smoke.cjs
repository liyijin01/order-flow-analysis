const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const intervalSecMap={ '15m':900,'30m':1800,'1h':3600,'2h':7200,'4h':14400,'1d':86400 };
const bases={BTCUSDT:82000,ETHUSDT:2700,SOLUSDT:120};
const cache=new Map();

function generatedRows(symbol,interval,count=6500){
  const key=symbol+'|'+interval;
  if(cache.has(key)) return cache.get(key);
  const sec=intervalSecMap[interval]||3600;
  const base=bases[symbol]||100;
  const endSec=Math.floor(Date.UTC(2026,8,26,0,0,0)/1000);
  const startSec=endSec-sec*(count-1);
  const rows=[];
  for(let i=0;i<count;i++){
    const t=(startSec+i*sec)*1000;
    const drift=Math.sin(i/19)*base*.025 + Math.cos(i/47)*base*.012;
    const open=base+drift;
    const close=open+Math.sin(i/7)*base*.003;
    const high=Math.max(open,close)+base*.0025;
    const low=Math.min(open,close)-base*.0025;
    const vol=100+(i%31)*7;
    rows.push([t,open.toFixed(6),high.toFixed(6),low.toFixed(6),close.toFixed(6),vol.toFixed(3),t+sec*1000-1,(vol*close).toFixed(3),100+(i%50),(vol*.52).toFixed(3),(vol*close*.52).toFixed(3),'0']);
  }
  cache.set(key,rows);
  return rows;
}

function profilePayload(symbol){
  const binSize={BTCUSDT:100,ETHUSDT:5,SOLUSDT:.5}[symbol]||1;
  const rows=[];
  for(let i=-10;i<=10;i++){
    const index=Math.round((bases[symbol]/binSize)+i);
    const buy=100-Math.abs(i)*4, sell=90-Math.abs(i)*3;
    rows.push([index,buy,sell]);
  }
  return {
    schema:'profiles-v2',symbol,base:symbol.replace('USDT',''),binSize:String(binSize),generatedAt:'2026-09-26T00:00:00Z',
    source:'test',statuses:{},
    profiles:{
      previous:{label:'previous',expectedDays:['2026-09-14'],days:['2026-09-14'],missingDays:[],failedDays:[],complete:true,rows},
      current:{label:'current',expectedDays:['2026-09-21'],days:['2026-09-21'],missingDays:[],failedDays:[],complete:true,rows}
    }
  };
}

async function installRoutes(page, counters){
  await page.route(/https:\/\/(fapi\.binance\.com|api\.binance\.com)\/.*klines.*/, async route=>{
    counters.binance++;
    const url=new URL(route.request().url());
    const symbol=url.searchParams.get('symbol')||'BTCUSDT';
    const interval=url.searchParams.get('interval')||'1h';
    const all=generatedRows(symbol,interval);
    const endTime=Number(url.searchParams.get('endTime'))||Infinity;
    const limit=Math.max(1,Math.min(Number(url.searchParams.get('limit'))||500,1500));
    const eligible=all.filter(r=>Number(r[0])<=endTime);
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(eligible.slice(-limit))});
  });
  await page.route(/http:\/\/127\.0\.0\.1:8000\/profiles-(BTCUSDT|ETHUSDT|SOLUSDT)\.json/, async route=>{
    const m=route.request().url().match(/profiles-(BTCUSDT|ETHUSDT|SOLUSDT)\.json/);
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(profilePayload(m[1]))});
  });
}

(async()=>{
  const outDir=path.resolve('c2-1-c4-smoke-artifacts');fs.mkdirSync(outDir,{recursive:true});
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const errors=[];
  try{
    // C2.1 sample mode: static candles only, no Binance requests.
    for(const preset of ['p1','p2','p3','p4','p5']){
      const page=await browser.newPage({viewport:{width:1500,height:900},deviceScaleFactor:1});
      page.on('console',msg=>{if(msg.type()==='error')errors.push(preset+': '+msg.text());});
      page.on('pageerror',err=>errors.push(preset+': '+err.message));
      const counters={binance:0};await installRoutes(page,counters);
      await page.goto('http://127.0.0.1:8000/chart.html?fixture='+preset,{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>document.getElementById('status')?.textContent.includes('SAMPLE 样例数据'),undefined,{timeout:30000});
      if(counters.binance!==0) throw new Error(preset+' sample requested Binance '+counters.binance+' times');
      const visible=await page.evaluate(()=>{
        const box=document.getElementById('chart').getBoundingClientRect();
        const coords=window.__orderFlowChartDebug.annotationCoordinates();
        return {w:box.width,h:box.height,coords,status:document.getElementById('status').textContent};
      });
      if(visible.status.includes('Loaded ')) throw new Error(preset+' sample looks like live data');
      for(const p of visible.coords){
        if(Number.isFinite(p.x) && (p.x < -1 || p.x > visible.w+1)) throw new Error(preset+' x outside plot '+JSON.stringify(p));
        if(Number.isFinite(p.y) && (p.y < -1 || p.y > visible.h+1)) throw new Error(preset+' y outside plot '+JSON.stringify(p));
      }
      await page.selectOption('#exportSize','current');
      const dl=page.waitForEvent('download',{timeout:30000});await page.click('#exportBtn');const d=await dl;
      const target=path.join(outDir,preset+'-sample.png');await d.saveAs(target);if(fs.statSync(target).size<15000)throw new Error(preset+' sample export too small');
      await page.close();
    }

    // F1 browser path: latest endpoint returns [T-1,T]; current T still updates.
    {
      const page=await browser.newPage({viewport:{width:1400,height:850}});
      let latestBump=0;
      await page.route(/https:\/\/fapi\.binance\.com\/.*klines.*/, async route=>{
        const url=new URL(route.request().url()),symbol=url.searchParams.get('symbol')||'BTCUSDT',interval=url.searchParams.get('interval')||'1h';
        let rows=generatedRows(symbol,interval);
        const limit=Number(url.searchParams.get('limit'))||1500;
        if(limit===2){
          rows=rows.slice(-2).map(r=>r.slice());
          latestBump+=1;
          rows[1][4]=(Number(rows[1][4])+latestBump*5).toFixed(6);
          rows[1][2]=Math.max(Number(rows[1][2]),Number(rows[1][4])).toFixed(6);
        }else rows=rows.slice(-limit);
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(rows)});
      });
      await page.goto('http://127.0.0.1:8000/chart.html?symbol=BTCUSDT&market=um&interval=1h',{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),undefined,{timeout:30000});
      const before=await page.evaluate(()=>window.__orderFlowChartDebug.state.data.at(-1).close);
      await page.evaluate(()=>window.__orderFlowChartDebug.refreshLatest());
      await page.waitForTimeout(300);
      const after=await page.evaluate(()=>window.__orderFlowChartDebug.state.data.at(-1).close);
      if(!(after>before)) throw new Error('F1 live refresh did not update current candle');
      await page.close();
    }

    // C4: P1-P4 x BTC/ETH/SOL, period-correct REST, render and export.
    for(const auto of ['p1','p2','p3','p4']){
      for(const symbol of ['BTCUSDT','ETHUSDT','SOLUSDT']){
        const page=await browser.newPage({viewport:{width:1500,height:900},deviceScaleFactor:1});
        page.on('console',msg=>{if(msg.type()==='error')errors.push(auto+' '+symbol+': '+msg.text());});
        page.on('pageerror',err=>errors.push(auto+' '+symbol+': '+err.message));
        const counters={binance:0};await installRoutes(page,counters);
        await page.goto('http://127.0.0.1:8000/chart.html?symbol='+symbol+'&market=um&auto='+auto,{waitUntil:'domcontentloaded',timeout:60000});
        await page.waitForFunction(()=>document.getElementById('status')?.textContent.includes('annotations '),undefined,{timeout:60000});
        const state=await page.evaluate(()=>({stats:window.__orderFlowChartDebug.annotationStats(),coords:window.__orderFlowChartDebug.annotationCoordinates(),status:document.getElementById('status').textContent}));
        if(!state.stats.rendered) throw new Error(auto+' '+symbol+' rendered no annotations');
        if(state.status.includes('SAMPLE')) throw new Error(auto+' '+symbol+' incorrectly in sample mode');
        if(!counters.binance) throw new Error(auto+' '+symbol+' did not use real-data REST path');
        await page.selectOption('#exportSize','current');
        const dl=page.waitForEvent('download',{timeout:30000});await page.click('#exportBtn');const d=await dl;
        const target=path.join(outDir,auto+'-'+symbol+'.png');await d.saveAs(target);if(fs.statSync(target).size<15000)throw new Error(auto+' '+symbol+' export too small');
        await page.close();
      }
    }
  } finally { await browser.close(); }
  if(errors.length){console.error(errors.join('\n'));process.exit(1);}
  console.log('C2.1/C3/C4 browser smoke passed: 5 static samples, F1 live refresh, 12 auto preset exports.');
})().catch(err=>{console.error(err);process.exit(1);});
