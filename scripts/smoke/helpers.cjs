const fs=require('fs'),path=require('path');
const monthlyFixture=JSON.parse(fs.readFileSync(path.resolve('web/tests/fixtures/btcusdt-um-1M-2026-10-01.json'),'utf8'));

const intervalSec={'30m':1800,'1h':3600,'4h':14400,'1d':86400,'1w':604800,'1M':2678400};
const baseMap={BTCUSDT:82000,ETHUSDT:2700,SOLUSDT:120};
const displayCount={'4h':540,'1h':720,'1d':365,'1M':120};
const expectedVisible={'4h':180,'1h':240,'1d':180};
const cache=new Map();

function rows(symbol,interval){
  const key=symbol+'|'+interval;if(cache.has(key))return cache.get(key);
  const sec=intervalSec[interval],base=baseMap[symbol]||100;
  if(interval==='1M'){
    const scale=base/(baseMap.BTCUSDT||82000),out=monthlyFixture.bars.map(b=>{
      const open=Number(b.open)*scale,high=Number(b.high)*scale,low=Number(b.low)*scale,close=Number(b.close)*scale,vol=Number(b.volume)||1000,buy=Number(b.takerBuyBase)||vol*.5;
      return[Number(b.openTime),open.toFixed(8),high.toFixed(8),low.toFixed(8),close.toFixed(8),vol.toFixed(4),Number(b.closeTime),(vol*close).toFixed(4),100,buy.toFixed(4),(buy*close).toFixed(4),'0'];
    });
    cache.set(key,out);return out;
  }
  const end=interval==='1w'
    ?Math.floor(Date.UTC(2026,8,21,0,0,0)/1000)
    :Math.floor(Date.UTC(2026,8,27,0,0,0)/1000);
  const count=interval==='1h'?5200:interval==='30m'?3800:interval==='4h'?3200:interval==='1d'?500:380;
  const start=end-sec*(count-1),out=[];
  for(let i=0;i<count;i++){
    const t=(start+i*sec)*1000,wave=Math.sin(i/37)*base*.045+Math.cos(i/83)*base*.025;
    const trend=Math.sin(i/700)*base*.025,open=base+wave+trend,delta=Math.sin(i/11)*base*.004,close=open+delta;
    const high=Math.max(open,close)+base*.004,low=Math.min(open,close)-base*.004,vol=1000+(i%47)*17;
    const buy=delta>=0?vol*.62:vol*.38;
    out.push([t,open.toFixed(8),high.toFixed(8),low.toFixed(8),close.toFixed(8),vol.toFixed(4),t+sec*1000-1,(vol*close).toFixed(4),100,buy.toFixed(4),(buy*close).toFixed(4),'0']);
  }
  cache.set(key,out);return out;
}

async function routeMarket(page,requests,options){
  const opts=options||{};let failed30m=false;
  await page.route(/https:\/\/fapi\.binance\.com\/fapi\/v1\/klines.*/,async route=>{
    const u=new URL(route.request().url()),symbol=u.searchParams.get('symbol'),interval=u.searchParams.get('interval');
    const endRaw=u.searchParams.get('endTime'),end=endRaw==null?Infinity:Number(endRaw);
    const limit=Math.min(1500,Number(u.searchParams.get('limit'))||500);
    requests.push({symbol,interval,limit,endTime:endRaw});
    if(opts.delayMs)await new Promise(resolve=>setTimeout(resolve,opts.delayMs));
    if(opts.failFirst30m&&interval==='30m'&&!failed30m){
      failed30m=true;await route.fulfill({status:500,contentType:'text/plain',body:'synthetic 30m failure'});return;
    }
    const body=rows(symbol,interval).filter(r=>Number(r[0])<=end).slice(-limit);
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
}

async function routeRefreshSeconds(page,seconds){
  await page.route('**/config/analysis-rules.json',async route=>{
    const response=await route.fetch(),body=await response.json();
    body.display.refreshSeconds=seconds;
    await route.fulfill({response,contentType:'application/json',body:JSON.stringify(body)});
  });
}

function exactProfileFixture(symbol,nowValue){
  const now=nowValue?new Date(nowValue):new Date(),today=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());
  const day=(new Date(today).getUTCDay()+6)%7,monday=today-day*86400000,previous=monday-7*86400000;
  const expectedDays=Array.from({length:7},(_,i)=>new Date(previous+i*86400000).toISOString().slice(0,10));
  const binSize=symbol==='BTCUSDT'?1:(symbol==='ETHUSDT'?.1:.01);
  const center=Math.round((baseMap[symbol]||100)*.85/binSize);
  return{
    schema:'profiles-v2',symbol,binSize,
    generatedAt:now.toISOString(),source:'synthetic smoke fixture',
    profiles:{
      previous:{
        label:expectedDays[0]+' to '+expectedDays[6],expectedDays,days:expectedDays,missingDays:[],failedDays:[],complete:true,
        rows:[[center-2,100,90],[center-1,180,160],[center,300,280],[center+1,170,150],[center+2,90,80]]
      },
      current:{label:'current',expectedDays:[],days:[],missingDays:[],failedDays:[],complete:true,rows:[]}
    }
  };
}

async function routeProfiles(page,nowValue){
  await page.route(/\/profiles-([A-Z]+)\.json(?:\?.*)?$/,async route=>{
    const m=route.request().url().match(/profiles-([A-Z]+)\.json/),symbol=m&&m[1]||'BTCUSDT';
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(exactProfileFixture(symbol,nowValue))});
  });
}

async function failProfileOnce(page){
  let failed=false;
  await page.route(/\/profiles-([A-Z]+)\.json(?:\?.*)?$/,async route=>{
    const m=route.request().url().match(/profiles-([A-Z]+)\.json/),symbol=m&&m[1]||'BTCUSDT';
    if(!failed){failed=true;await route.fulfill({status:404,contentType:'text/plain',body:'synthetic profile miss'});return;}
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(exactProfileFixture(symbol))});
  });
}

function keyLevelFixture(symbol){
  const base=baseMap[symbol]||100,tick=symbol==='BTCUSDT'?.1:(symbol==='ETHUSDT'?.01:.001);
  const iso=(y,m,d)=>new Date(Date.UTC(y,m-1,d)).toISOString();
  const row=(id,label,kind,side,price,start,definition,end=iso(2026,1,1))=>({id,label,kind,side,price,periodStart:start,periodEnd:end,definition});
  return{
    schema:'analysis-key-levels-v1',symbol,generatedAt:'2026-09-27T00:00:00Z',cutoffUtc:'2026-09-26T23:59:59Z',
    levels:[
      row('q1-vah','Q1 VAH','quarter','VAH',base,iso(2026,1,1),'Q / 1h VWAP±1σ'),
      row('py-q4-vah','PY Q4 VAH','py-quarter','VAH',base+tick*.5,iso(2025,10,1),'Q / 1h VWAP±1σ'),
      row('q2-val','Q2 VAL','quarter','VAL',base*.98,iso(2026,4,1),'Q / 1h VWAP±1σ'),
      row('py-nov-val','PY Nov VAL','py-month','VAL',base*1.003,iso(2025,11,1),'M / 30m TPO'),
      row('py-oct-vah','PY Oct VAH','py-month','VAH',base*.97,iso(2025,10,1),'M / 30m TPO'),
      row('py-sep-val','PY Sep VAL','py-month','VAL',base*1.02,iso(2025,9,1),'M / 30m TPO'),
      row('py-q3-val','PY Q3 VAL','py-quarter','VAL',base*.96,iso(2025,7,1),'Q / 1h VWAP±1σ'),
      row('py-q2-vah','PY Q2 VAH','py-quarter','VAH',base*1.03,iso(2025,4,1),'Q / 1h VWAP±1σ'),
      row('py-jan-val','PY Jan VAL','py-month','VAL',base*.95,iso(2025,1,1),'M / 30m TPO'),
      row('q3-vah','Q3 VAH','quarter','VAH',base*1.01,iso(2026,7,1),'Q / 1h VWAP±1σ',iso(2026,10,1)),
      row('q3-val','Q3 VAL','quarter','VAL',base*.99,iso(2026,7,1),'Q / 1h VWAP±1σ',iso(2026,10,1)),
      row('year-2024-vwap','2024 VWAP','year','VWAP',base*.94,iso(2024,1,1),'Y / 4h VWAP±1σ (hlc3)',iso(2025,1,1)),
      row('year-2024-vah','2024 VAH','year','VAH',base*.985,iso(2024,1,1),'Y / 4h VWAP±1σ (hlc3)',iso(2025,1,1)),
      row('year-2024-val','2024 VAL','year','VAL',base*.89,iso(2024,1,1),'Y / 4h VWAP±1σ (hlc3)',iso(2025,1,1)),
      row('year-2025-vwap','PY VWAP','year','VWAP',base*1.035,iso(2025,1,1),'Y / 4h VWAP±1σ (hlc3)',iso(2026,1,1)),
      row('year-2025-vah','PY VAH','year','VAH',base*1.08,iso(2025,1,1),'Y / 4h VWAP±1σ (hlc3)',iso(2026,1,1)),
      row('year-2025-val','PY VAL','year','VAL',base*.97,iso(2025,1,1),'Y / 4h VWAP±1σ (hlc3)',iso(2026,1,1))
    ]
  };
}

async function routeKeyLevels(page,mode){
  await page.route(/\/analysis\/levels\/([A-Z]+)\.json(?:\?.*)?$/,async route=>{
    const m=route.request().url().match(/levels\/([A-Z]+)\.json/),symbol=m&&m[1]||'ETHUSDT';
    if(mode==='404'){await route.fulfill({status:404,contentType:'text/plain',body:'synthetic levels miss'});return;}
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(keyLevelFixture(symbol))});
  });
}

function va(rowsList,rowSize,pct){
  const sorted=rowsList.slice().sort((a,b)=>a[0]-b[0]);if(!sorted.length)return null;
  const total=sorted.reduce((n,x)=>n+Number(x[1]),0);if(!(total>0))return null;
  const midpoint=(sorted[0][0]+sorted[sorted.length-1][0]+rowSize)/2;
  let max=-Infinity,pocIndex=0,best=Infinity;
  for(let i=0;i<sorted.length;i++){
    const value=Number(sorted[i][1]),dist=Math.abs(sorted[i][0]+rowSize/2-midpoint);
    if(value>max||(value===max&&dist<best)){max=value;pocIndex=i;best=dist;}
  }
  let lo=pocIndex,hi=pocIndex,acc=Number(sorted[pocIndex][1]),target=total*(pct==null?.70:Number(pct));
  while(acc<target&&(lo>0||hi<sorted.length-1)){
    const up=hi<sorted.length-1?Number(sorted[hi+1][1]):-1,dn=lo>0?Number(sorted[lo-1][1]):-1;
    if(up>=dn&&hi<sorted.length-1){hi++;acc+=Number(sorted[hi][1]);}
    else if(lo>0){lo--;acc+=Number(sorted[lo][1]);}
    else{hi++;acc+=Number(sorted[hi][1]);}
  }
  return{poc:sorted[pocIndex][0]+rowSize/2,vah:sorted[hi][0]+rowSize,val:sorted[lo][0]};
}

function syntheticTpoPeriod(symbol,startSec,endSec,index,withRows){
  const base=baseMap[symbol]||100,rowSize=(symbol==='BTCUSDT'?.1:(symbol==='ETHUSDT'?.01:.001))*100;
  const center=base*(1+Math.sin(index*.71)*.055+Math.cos(index*.29)*.02),centerIndex=Math.round(center/rowSize),profileRows=[];
  for(let j=-10;j<=10;j++){
    const count=Math.max(1,11-Math.abs(j)+((index+j+200)%3));
    profileRows.push([(centerIndex+j)*rowSize,count]);
  }
  const area=va(profileRows,rowSize,.70),low=profileRows[0][0],high=profileRows[profileRows.length-1][0]+rowSize;
  const out={
    start:new Date(startSec*1000).toISOString(),end:new Date(endSec*1000).toISOString(),complete:true,
    bars:Math.round((endSec-startSec)/1800),expectedBars:Math.round((endSec-startSec)/1800),
    rowSize,poc:area.poc,vah:area.vah,val:area.val,high,low,singlePrints:[]
  };
  if(withRows)out.rows=profileRows;
  return out;
}

function tpoFixture(symbol,nowValue){
  const now=nowValue?new Date(nowValue):new Date('2026-09-27T12:00:00Z');
  const currentMonth=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)/1000;
  const months=[];
  for(let i=12;i>=1;i--){
    const d=new Date(currentMonth*1000),start=Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-i,1)/1000,end=Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-i+1,1)/1000;
    months.push(syntheticTpoPeriod(symbol,start,end,13-i,true));
  }
  const day=(now.getUTCDay()+6)%7,currentWeek=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-day)/1000,weekly=[];
  for(let i=52;i>=1;i--){
    const start=currentWeek-i*7*86400,end=start+7*86400,idx=53-i;
    weekly.push(syntheticTpoPeriod(symbol,start,end,idx,i<=26));
  }
  return{schema:'analysis-tpo-v2',symbol,generatedAt:now.toISOString(),cutoffUtc:new Date(now.getTime()-1800000).toISOString(),monthly:months,weekly};
}

async function routeTpo(page,nowValue){
  await page.route(/\/analysis\/tpo\/([A-Z]+)\.json(?:\?.*)?$/,async route=>{
    const m=route.request().url().match(/tpo\/([A-Z]+)\.json/),symbol=m&&m[1]||'BTCUSDT';
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(tpoFixture(symbol,nowValue))});
  });
}

async function routePrecomputedAge(page,initialHours){
  const state={hours:Number(initialHours)||0};
  await page.route(/\/analysis\/(levels|tpo)\/[A-Z]+\.json(?:\?.*)?$/,async route=>{
    const response=await route.fetch(),body=await response.json();
    body.generatedAt=new Date(Date.now()-state.hours*3600000).toISOString();
    await route.fulfill({response,contentType:'application/json',body:JSON.stringify(body)});
  });
  return state;
}

async function routeSnapshotThrough(page,cutoffIso){
  const cutoff=Date.parse(cutoffIso);
  await page.route(/\/analysis\/data\/([A-Z]+)\.json(?:\?.*)?$/,async route=>{
    const response=await route.fetch(),body=await response.json();
    body.cutoffUtc=cutoffIso;
    for(const [interval,seriesRows] of Object.entries(body.series||{})){
      if(!Array.isArray(seriesRows))continue;
      body.series[interval]=seriesRows.filter(row=>Number(row&&row[0])<cutoff);
    }
    await route.fulfill({response,contentType:'application/json',body:JSON.stringify(body)});
  });
}

module.exports={
  intervalSec,baseMap,displayCount,expectedVisible,rows,routeMarket,routeRefreshSeconds,exactProfileFixture,routeProfiles,
  failProfileOnce,keyLevelFixture,routeKeyLevels,tpoFixture,routeTpo,routePrecomputedAge,routeSnapshotThrough
};
