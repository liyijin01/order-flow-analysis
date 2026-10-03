(function(global){
  'use strict';

  const intervalMsMap={'30m':1800000,'1h':3600000,'4h':14400000,'1d':86400000,'1w':604800000,'1M':2678400000};
  const calcMap={'30m':'4h','1h':'4h','4h':'1d','1d':'1w','1M':'1d'};
  const displayCounts={'30m':1152,'1h':720,'4h':1200,'1d':365,'1M':120};

  function isAbort(error,signal){return !!(signal&&signal.aborted)||!!(error&&error.name==='AbortError');}
  function sleep(ms,signal){
    if(!signal)return new Promise(r=>setTimeout(r,ms));
    if(signal.aborted){const e=new Error('Aborted');e.name='AbortError';return Promise.reject(e);}
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{signal.removeEventListener('abort',onAbort);resolve();},ms);
      const onAbort=()=>{clearTimeout(timer);signal.removeEventListener('abort',onAbort);const e=new Error('Aborted');e.name='AbortError';reject(e);};
      signal.addEventListener('abort',onAbort,{once:true});
    });
  }
  function intervalMs(interval){return intervalMsMap[interval]||3600000;}
  function intervalSec(interval){return Math.floor(intervalMs(interval)/1000);}
  function endpoint(market){return market==='spot'?'https://api.binance.com/api/v3/klines':'https://fapi.binance.com/fapi/v1/klines';}
  function maxLimit(market){return market==='spot'?1000:1500;}

  async function requestJson(url,retries,signal){
    let error=null;
    for(let i=0;i<(retries||4);i++){
      let response;
      try{response=await fetch(url,{cache:'no-store',signal});}
      catch(e){
        if(isAbort(e,signal))throw e;
        error=e;if(i+1<(retries||4))await sleep(500*(2**i),signal);continue;
      }
      if(response.ok)return response.json();
      if(response.status===429||response.status===418){
        const ra=Number(response.headers.get('Retry-After'));
        await sleep(Number.isFinite(ra)&&ra>0?ra*1000:1000*(2**i),signal);error=new Error('HTTP '+response.status);continue;
      }
      throw new Error('HTTP '+response.status);
    }
    throw error||new Error('request failed');
  }

  function normalizeMs(v){
    let n=Number(v);
    if(n>10_000_000_000_000)n=Math.floor(n/1000);
    return n;
  }

  function parseRows(rows){
    return(rows||[]).map(r=>{
      if(!Array.isArray(r))return r;
      const ms=normalizeMs(r[0]),closeMs=normalizeMs(r[6]);
      return{
        time:Math.floor(ms/1000),openTime:ms,closeTime:closeMs,
        open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),
        volume:Number(r[5]),quoteVolume:Number(r[7]||0),trades:Number(r[8]||0),takerBuyBase:Number(r[9]||0),takerBuyQuote:Number(r[10]||0)
      };
    }).filter(b=>Number.isFinite(b.time)&&Number.isFinite(b.open)&&Number.isFinite(b.close));
  }

  function closedBars(bars,asOfMs){
    const cutoff=Number(asOfMs);
    return(bars||[]).filter(b=>{
      const close=Number(b.closeTime);
      if(Number.isFinite(close))return close<cutoff;
      return (Number(b.time)*1000)<cutoff;
    });
  }

  async function fetchHistory(symbol,interval,maxBars,endTime,signal,market){
    const m=market||'um',pageMax=maxLimit(m);
    if(interval==='1M'){
      const limit=Math.min(pageMax,Math.max(1,Number(maxBars)||120));
      const params=new URLSearchParams({symbol,interval,limit:String(limit)});
      return parseRows(await requestJson(endpoint(m)+'?'+params.toString(),4,signal)).slice(-limit);
    }
    const all=[];let end=Number.isFinite(endTime)?Number(endTime):Date.now();
    while(all.length<maxBars){
      const limit=Math.min(pageMax,maxBars-all.length);
      const params=new URLSearchParams({symbol,interval,limit:String(limit),endTime:String(Math.floor(end))});
      const raw=await requestJson(endpoint(m)+'?'+params.toString(),4,signal);
      if(!Array.isArray(raw)||!raw.length)break;
      const page=parseRows(raw);all.unshift(...page);
      const earliest=page[0]&&page[0].openTime;
      if(!Number.isFinite(earliest)||page.length<limit)break;
      end=earliest-1;
    }
    const dedup=new Map();for(const b of all)dedup.set(b.time,b);
    return Array.from(dedup.values()).sort((a,b)=>a.time-b.time).slice(-maxBars);
  }

  async function fetchLatest(symbol,interval,limit,signal,market){
    const m=market||'um',n=Math.max(1,Math.min(3,Number(limit)||3));
    const params=new URLSearchParams({symbol,interval,limit:String(n)});
    return parseRows(await requestJson(endpoint(m)+'?'+params.toString(),3,signal));
  }

  function mergeBars(existing,incoming,maxBars){
    const map=new Map();
    for(const b of existing||[])map.set(Number(b.time),b);
    for(const b of incoming||[])map.set(Number(b.time),b);
    const out=Array.from(map.values()).sort((a,b)=>Number(a.time)-Number(b.time));
    return out.slice(-Math.max(1,Number(maxBars)||out.length));
  }

  function capFor(interval,timeframe,history){
    let cap=500;
    if(interval==='1h')cap=5000;
    else if(interval==='30m')cap=3500;
    else if(interval==='1w')cap=400;
    else if(interval==='1d')cap=Math.max(430,displayCounts[timeframe]||0,400);
    else if(interval==='4h')cap=Math.max(1200,displayCounts[timeframe]||0,400);
    else if(interval==='1M')cap=Math.max(120,displayCounts[timeframe]||0);
    if(interval===timeframe)cap=Math.max(cap,displayCounts[timeframe]||0);
    if(interval===calcMap[timeframe])cap=Math.max(cap,400);
    const requested=Number(history&&history[interval])||0;if(requested>0)cap=Math.max(cap,requested);
    return cap;
  }

  async function fetchProfile(symbol,signal){
    try{
      const r=await fetch('profiles-'+symbol+'.json',{cache:'no-store',signal});
      if(!r.ok)throw new Error('HTTP '+r.status);
      return await r.json();
    }catch(e){
      if(isAbort(e,signal))throw e;
      return null;
    }
  }

  async function fetchKeyLevels(symbol,generatedAt,signal){
    const suffix=generatedAt?'?v='+encodeURIComponent(generatedAt):'';
    const r=await fetch('analysis/levels/'+symbol+'.json'+suffix,{signal});
    if(!r.ok)throw new Error('levels '+symbol+' HTTP '+r.status);
    return r.json();
  }

  async function loadSnapshot(symbol){
    const r=await fetch('analysis/data/'+symbol+'.json',{cache:'no-store'});
    if(!r.ok)throw new Error('snapshot '+symbol+' HTTP '+r.status);
    const payload=await r.json(),series={},errors={...(payload.errors||{})};
    for(const [k,v] of Object.entries(payload.series||{}))series[k]=parseRows(v);
    let keyLevels=null;
    try{keyLevels=await fetchKeyLevels(symbol,payload.generatedAt);}
    catch(e){errors.levels=String(e.message||e);}
    return{schema:payload.schema||'analysis-snapshot-v1',symbol,generatedAt:payload.generatedAt,cutoffUtc:payload.cutoffUtc,series,profile:payload.profile||null,keyLevels,errors};
  }

  async function loadLive(symbol,timeframe,onProgress,signal,history){
    const progress=typeof onProgress==='function'?onProgress:()=>{},errors={},series={};
    const required=timeframe==='1M'
      ?[timeframe,calcMap[timeframe],...Object.keys(history||{})]
      :[timeframe,'1h','30m',calcMap[timeframe],...Object.keys(history||{})];
    const intervals=[];for(const x of required)if(x&&!intervals.includes(x))intervals.push(x);
    let done=0;const total=intervals.length+2;
    const step=(label)=>{done++;progress({done,total,label});};
    await Promise.all(intervals.map(interval=>
      fetchHistory(symbol,interval,capFor(interval,timeframe,history),undefined,signal)
        .then(v=>{series[interval]=v;step(interval);})
        .catch(e=>{if(isAbort(e,signal))throw e;errors[interval]=String(e.message||e);step(interval+' failed');})
    ));
    const profile=await fetchProfile(symbol,signal);step('exact weekly profile');
    if(!profile)errors.profile='profiles-'+symbol+'.json unavailable';
    const generatedAt=new Date().toISOString();let keyLevels=null;
    try{keyLevels=await fetchKeyLevels(symbol,generatedAt,signal);step('historical key levels');}
    catch(e){if(isAbort(e,signal))throw e;errors.levels=String(e.message||e);step('historical key levels failed');}
    if(!(series[timeframe]||[]).length)throw new Error(errors[timeframe]||'display candles unavailable');
    return{schema:'analysis-live-v2',symbol,generatedAt,cutoffUtc:null,series,profile,keyLevels,errors};
  }

  async function refreshLiveBundle(bundle,symbol,timeframe,signal,history){
    const required=timeframe==='1M'
      ?[timeframe,calcMap[timeframe],...Object.keys(history||{})]
      :[timeframe,'1h','30m',calcMap[timeframe],...Object.keys(history||{})],intervals=[];
    for(const x of required)if(x&&!intervals.includes(x))intervals.push(x);
    const failures=[],updates={},fullIntervals=new Set(),errors={...(bundle&&bundle.errors||{})};
    await Promise.all(intervals.map(async interval=>{
      const cap=capFor(interval,timeframe,history),existing=(bundle&&bundle.series&&bundle.series[interval])||[];
      const needsFull=!!errors[interval]||existing.length<cap*.5;
      try{
        updates[interval]=needsFull
          ?await fetchHistory(symbol,interval,cap,undefined,signal)
          :await fetchLatest(symbol,interval,3,signal);
        if(needsFull){fullIntervals.add(interval);delete errors[interval];}
      }catch(e){
        if(isAbort(e,signal))throw e;
        failures.push({interval,error:String(e.message||e)});
      }
    }));
    const series={...(bundle&&bundle.series||{})};
    for(const interval of intervals){
      if(!updates[interval])continue;
      series[interval]=fullIntervals.has(interval)
        ?updates[interval]
        :mergeBars(series[interval]||[],updates[interval],capFor(interval,timeframe,history));
    }
    let profile=bundle&&bundle.profile||null;
    if(!profile||errors.profile){
      const recovered=await fetchProfile(symbol,signal);
      if(recovered){profile=recovered;delete errors.profile;}
      else{
        errors.profile='profiles-'+symbol+'.json unavailable';
        failures.push({interval:'profile',error:errors.profile});
      }
    }
    const generatedAt=new Date().toISOString();let keyLevels=bundle&&bundle.keyLevels||null;
    if(!keyLevels||errors.levels){
      try{keyLevels=await fetchKeyLevels(symbol,generatedAt,signal);delete errors.levels;}
      catch(e){
        if(isAbort(e,signal))throw e;
        errors.levels=String(e.message||e);failures.push({interval:'levels',error:errors.levels});
      }
    }
    return{
      bundle:{...(bundle||{}),schema:'analysis-live-v2',symbol,generatedAt,series,profile,keyLevels,errors},
      failures
    };
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
    intervalMs,intervalSec,displayCounts,calcMap,parseRows,closedBars,fetchHistory,fetchLatest,mergeBars,capFor,
    fetchProfile,fetchKeyLevels,loadSnapshot,loadLive,refreshLiveBundle,formatJst,toDisplayTime,formatDisplayTime,formatDisplayTick
  };
})(typeof globalThis!=='undefined'?globalThis:window);
