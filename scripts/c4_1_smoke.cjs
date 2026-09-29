const { chromium } = require('playwright-core');

const intervalSecMap={'15m':900,'30m':1800,'1h':3600,'2h':7200,'4h':14400,'1d':86400};
const bases={BTCUSDT:82000,ETHUSDT:2700,SOLUSDT:120};
const cache=new Map();

function generatedRows(symbol,interval){
  const key=symbol+'|'+interval;
  if(cache.has(key))return cache.get(key);
  const sec=intervalSecMap[interval]||3600,base=bases[symbol]||100;
  const count=Math.ceil(220*86400/sec)+100;
  const endSec=Math.floor(Date.UTC(2026,8,26,0,0,0)/1000),startSec=endSec-sec*(count-1);
  const rows=[];
  for(let i=0;i<count;i++){
    const t=(startSec+i*sec)*1000,drift=Math.sin(i/19)*base*.025+Math.cos(i/47)*base*.012;
    const open=base+drift,close=open+Math.sin(i/7)*base*.003,high=Math.max(open,close)+base*.0025,low=Math.min(open,close)-base*.0025,vol=100+(i%31)*7;
    rows.push([t,open.toFixed(6),high.toFixed(6),low.toFixed(6),close.toFixed(6),vol.toFixed(3),t+sec*1000-1,(vol*close).toFixed(3),100+(i%50),(vol*.52).toFixed(3),(vol*close*.52).toFixed(3),'0']);
  }
  cache.set(key,rows);return rows;
}

async function installRoutes(page){
  await page.route(/https:\/\/(fapi\.binance\.com|api\.binance\.com)\/.*klines.*/,async route=>{
    const url=new URL(route.request().url()),symbol=url.searchParams.get('symbol')||'BTCUSDT',interval=url.searchParams.get('interval')||'1h';
    const start=Number(url.searchParams.get('startTime'))||-Infinity,end=Number(url.searchParams.get('endTime'))||Infinity;
    const limit=Math.max(1,Math.min(Number(url.searchParams.get('limit'))||500,url.hostname.startsWith('api.')?1000:1500));
    const rows=generatedRows(symbol,interval).filter(r=>Number(r[0])>=start&&Number(r[0])<=end).slice(-limit);
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(rows)});
  });
}

(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1500,height:900},deviceScaleFactor:1});
    await installRoutes(page);
    await page.goto('http://127.0.0.1:8000/chart.html?symbol=BTCUSDT&market=um&interval=1h',{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),undefined,{timeout:30000});

    // B5: ten tightly packed levels must get readable right-side label coordinates.
    const spacing=await page.evaluate(()=>{
      const d=window.__orderFlowChartDebug,base=d.state.data.at(-1).close,first=d.state.data[0].time;
      const items=[];
      for(let i=0;i<10;i++)items.push({
        id:'spacing-'+i,type:'level',price:base*(1+i*.0005),label:'L'+i,from:first,to:null,
        style:'dashed',color:'#e6e6e6',axisLabel:true,showLabel:true,source:'exact'
      });
      d.annotations.render({schema:'annotations-v1',symbol:d.state.symbol,market:d.state.market,interval:d.state.interval,generatedAt:new Date().toISOString(),items});
      d.annotations.relayoutLabels();
      const prices=new Map(items.map(x=>[x.id,x.price]));
      return d.annotationCoordinates().filter(x=>x.type==='level').map(x=>({
        labelY:x.labelY,axisY:x.axisY,trueY:d.state.candles.priceToCoordinate(Number(prices.get(x.id)))
      })).sort((a,b)=>a.labelY-b.labelY);
    });
    for(let i=1;i<spacing.length;i++){
      if(spacing[i].labelY-spacing[i-1].labelY<11.99)throw new Error('B5 label spacing failed '+JSON.stringify(spacing));
    }
    for(const row of spacing)if(Math.abs(Number(row.axisY)-Number(row.trueY))>1){
      throw new Error('B5 price-axis label moved off true price '+JSON.stringify(spacing));
    }

    // Mock router contract: symbol/interval/startTime/endTime are all honored over >= 6 months of source data.
    const contract=await page.evaluate(async()=>{
      const start=Date.UTC(2026,3,1),end=Date.UTC(2026,3,3);
      const r=await fetch('https://fapi.binance.com/fapi/v1/klines?symbol=ETHUSDT&interval=30m&startTime='+start+'&endTime='+end+'&limit=1500');
      const rows=await r.json();
      return {n:rows.length,min:Math.min(...rows.map(x=>Number(x[0]))),max:Math.max(...rows.map(x=>Number(x[0])))};
    });
    if(!(contract.n>0&&contract.min>=Date.UTC(2026,3,1)&&contract.max<=Date.UTC(2026,3,3)))throw new Error('mock route contract failed '+JSON.stringify(contract));

    await page.close();
  } finally {await browser.close();}
  console.log('C4.1 browser smoke passed: label spacing and six-month route contract.');
})().catch(err=>{console.error(err);process.exit(1);});
