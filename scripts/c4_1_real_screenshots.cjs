const { chromium }=require('playwright-core');
const fs=require('fs'),path=require('path'),zlib=require('zlib');

const pageUrl=process.env.PAGE_URL;
if(!pageUrl)throw new Error('PAGE_URL is required');
const data=JSON.parse(zlib.gunzipSync(fs.readFileSync(process.env.REAL_DATA||'_real/c4-1-market.json.gz')));
const outDir=path.resolve(process.env.OUT_DIR||'c4-1-real-screenshots');
fs.mkdirSync(outDir,{recursive:true});
const layouts={p1:'1h',p2:'30m',p3:'30m',p4:'2h'};
const symbols=['BTCUSDT','ETHUSDT','SOLUSDT'];

function routeRows(url){
  const symbol=url.searchParams.get('symbol'),interval=url.searchParams.get('interval');
  const all=data.series[symbol+'|'+interval];
  if(!all)throw new Error('missing real series '+symbol+'|'+interval);
  const start=Number(url.searchParams.get('startTime'))||-Infinity;
  const end=Number(url.searchParams.get('endTime'))||Infinity;
  const max= url.hostname.startsWith('api.') ? 1000 : 1500;
  const limit=Math.max(1,Math.min(Number(url.searchParams.get('limit'))||max,max));
  return all.filter(r=>Number(r[0])>=start&&Number(r[0])<=end).slice(-limit);
}

(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const manifest=[];
 try{
  for(const [preset,interval] of Object.entries(layouts)){
   for(const symbol of symbols){
    const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.route(/https:\/\/(fapi\.binance\.com|api\.binance\.com)\/.*klines.*/,async route=>{
      try{await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(routeRows(new URL(route.request().url()))) });}
      catch(e){await route.abort();throw e;}
    });
    const url=pageUrl+'?symbol='+symbol+'&market=um&interval='+interval+'&auto='+preset;
    let loaded=false;
    for(let attempt=0;attempt<5&&!loaded;attempt++){
      try{
        await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
        await page.waitForFunction(()=>document.getElementById('status')?.textContent.includes('annotations '),{timeout:60000});
        loaded=true;
      }catch(e){if(attempt===4)throw e;await page.waitForTimeout(3000);}
    }
    const meta=await page.evaluate(()=>({
      status:document.getElementById('status').textContent,
      title:document.getElementById('pageTitle').textContent,
      itemCount:window.__orderFlowChartDebug.annotations.lastDocument?.items?.length||0,
      lastTime:window.__orderFlowChartDebug.state.data.at(-1)?.time,
      firstTime:window.__orderFlowChartDebug.state.data[0]?.time,
    }));
    if(meta.status.includes('SAMPLE'))throw new Error(preset+' '+symbol+' unexpectedly sample');
    if(meta.itemCount<1)throw new Error(preset+' '+symbol+' no annotations');
    if(errors.length)throw new Error(preset+' '+symbol+' browser errors: '+errors.join(' | '));
    const file=preset.toUpperCase()+'-'+symbol+'-REAL.png';
    await page.screenshot({path:path.join(outDir,file),fullPage:true});
    manifest.push({preset,symbol,interval,file,url,status:meta.status,itemCount:meta.itemCount,firstTime:meta.firstTime,lastTime:meta.lastTime,source:'Binance Vision real archived klines'});
    await page.close();
   }
  }
 } finally {await browser.close();}
 fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2));
 console.log('Captured '+manifest.length+' online Pages screenshots with real Binance Vision klines.');
})().catch(e=>{console.error(e);process.exit(1);});
