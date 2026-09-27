(function(global){
  'use strict';

  const intervalMsMap={'30m':1800000,'1h':3600000,'4h':14400000,'1d':86400000,'1w':604800000};
  const calcMap={'1h':'4h','4h':'1d','1d':'1w'};
  const displayCounts={'1h':720,'4h':540,'1d':365};

  function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
  function intervalMs(interval){return intervalMsMap[interval]||3600000;}
  function intervalSec(interval){return Math.floor(intervalMs(interval)/1000);}
  function endpoint(){return'https://fapi.binance.com/fapi/v1/klines';}

  async function requestJson(url,retries){
    let error=null;
    for(let i=0;i<(retries||4);i++){
      let response;
      try{response=await fetch(url,{cache:'no-store'});}
      catch(e){error=e;if(i+1<retries)await sleep(500*(2**i));continue;}
      if(response.ok)return response.json();
      if(response.status===429||response.status===418){
        const ra=Number(response.headers.get('Retry-After'));
        await sleep(Number.isFinite(ra)&&ra>0?ra*1000:1000*(2**i));error=new Error('HTTP '+response.status);continue;
      }
      throw new Error('HTTP '+response.status);
    }
    throw error||new Error('request failed');
  }

  function parseRows(rows){
    return(rows||[]).map(r=>{
      if(!Array.isArray(r))return r;
      let ms=Number(r[0]);if(ms>10_000_000_000_000)ms=Math.floor(ms/1000);
      return{
        time:Math.floor(ms/1000),openTime:ms,closeTime:Number(r[6]),
        open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),
        volume:Number(r[5]),quoteVolume:Number(r[7]||0),trades:Number(r[8]||0),takerBuyBase:Number(r[9]||0)
      };
    }).filter(b=>Number.isFinite(b.time)&&Number.isFinite(b.open)&&Number.isFinite(b.close));
  }

  async function fetchHistory(symbol,interval,maxBars,endTime){
    const pageMax=1500,all=[];let end=Number.isFinite(endTime)?Number(endTime):Date.now();
    while(all.length<maxBars){
      const limit=Math.min(pageMax,maxBars-all.length);
      const params=new URLSearchParams({symbol,interval,limit:String(limit),endTime:String(Math.floor(end))});
      const raw=await requestJson(endpoint()+'?'+params.toString(),4);
      if(!Array.isArray(raw)||!raw.length)break;
      const page=parseRows(raw);all.unshift(...page);
      const earliest=page[0]&&page[0].openTime;
      if(!Number.isFinite(earliest)||page.length<limit)break;
      end=earliest-1;
    }
    const dedup=new Map();for(const b of all)dedup.set(b.time,b);
    return Array.from(dedup.values()).sort((a,b)=>a.time-b.time).slice(-maxBars);
  }

  async function fetchProfile(symbol){
    try{
      const r=await fetch('profiles-'+symbol+'.json',{cache:'no-store'});
      if(!r.ok)throw new Error('HTTP '+r.status);
      return await r.json();
    }catch(e){return null;}
  }

  async function loadSnapshot(symbol){
    const r=await fetch('analysis/data/'+symbol+'.json',{cache:'no-store'});
    if(!r.ok)throw new Error('snapshot '+symbol+' HTTP '+r.status);
    const payload=await r.json(),series={};
    for(const [k,v] of Object.entries(payload.series||{}))series[k]=parseRows(v);
    return{schema:payload.schema||'analysis-snapshot-v1',symbol,generatedAt:payload.generatedAt,cutoffUtc:payload.cutoffUtc,series,profile:payload.profile||null,errors:payload.errors||{}};
  }

  async function loadLive(symbol,timeframe,onProgress){
    const progress=typeof onProgress==='function'?onProgress:()=>{},errors={},series={};
    let done=0;const total=5;
    const step=(label)=>{done++;progress({done,total,label});};
    const tasks=[];

    tasks.push(fetchHistory(symbol,'1h',5000).then(v=>{series['1h']=v;step('PQ / 1h');}).catch(e=>{errors.pq=String(e.message||e);step('PQ / 1h failed');}));
    if(timeframe!=='1h')tasks.push(fetchHistory(symbol,timeframe,displayCounts[timeframe]||540).then(v=>{series[timeframe]=v;step('display '+timeframe);}).catch(e=>{errors.display=String(e.message||e);step('display failed');}));
    else tasks.push(Promise.resolve().then(()=>step('display 1h uses PQ data')));

    const calc=calcMap[timeframe];
    tasks.push(fetchHistory(symbol,calc,400).then(v=>{series[calc]=v;step('zones / '+calc);}).catch(e=>{errors.zones=String(e.message||e);step('zones failed');}));
    tasks.push(fetchHistory(symbol,'30m',3500).then(v=>{series['30m']=v;step('PM / nPOC');}).catch(e=>{errors.tpo=String(e.message||e);step('PM / nPOC failed');}));
    tasks.push(fetchProfile(symbol).then(v=>{if(v){}else errors.profile='profiles-'+symbol+'.json unavailable';return v;}).then(v=>{series._profile=v;step('exact weekly profile');}));

    await Promise.all(tasks);
    const one=series['1h']||[];
    if(timeframe==='1h')series.display=one.slice(-(displayCounts['1h']||720));
    else series.display=(series[timeframe]||[]).slice(-(displayCounts[timeframe]||540));
    const profile=series._profile||null;delete series._profile;
    if(!series.display.length)throw new Error(errors.display||'display candles unavailable');
    return{schema:'analysis-live-v1',symbol,generatedAt:new Date().toISOString(),cutoffUtc:null,series,profile,errors};
  }

  function formatJst(time){
    const d=new Date(Number(time)*1000);
    return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);
  }
  function toDisplayTime(time){return Number(time)+9*3600;}
  function formatDisplayTime(time){
    const d=new Date(Number(time)*1000);
    return new Intl.DateTimeFormat('ja-JP',{timeZone:'UTC',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);
  }
  function formatDisplayTick(time,type,locale){
    const d=new Date(Number(time)*1000),loc=locale||'ja-JP';
    const numeric=typeof type==='number'?type:null;
    if(numeric===0)return new Intl.DateTimeFormat(loc,{timeZone:'UTC',year:'numeric'}).format(d);
    if(numeric===1)return new Intl.DateTimeFormat(loc,{timeZone:'UTC',month:'numeric'}).format(d);
    if(numeric===2)return new Intl.DateTimeFormat(loc,{timeZone:'UTC',month:'2-digit',day:'2-digit'}).format(d).replace(/\//g,'/');
    return new Intl.DateTimeFormat(loc,{timeZone:'UTC',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);
  }

  global.OrderFlowAnalysisData={
    intervalMs,intervalSec,displayCounts,calcMap,parseRows,fetchHistory,fetchProfile,loadSnapshot,loadLive,
    formatJst,toDisplayTime,formatDisplayTime,formatDisplayTick
  };
})(typeof globalThis!=='undefined'?globalThis:window);
