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

  async function fetchHistorySerial(symbol,interval,maxBars,endTime,signal,market){
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

  function parallelPagePlan(interval,maxBars,firstOpenTime,market){
    const step=intervalMs(interval),limit=maxLimit(market||'um');
    const pages=[];
    // The last returned candle, not wall-clock time, anchors old history pages.
    // This avoids gaps when the exchange fixture or a market is lagging.
    for(let offset=0;offset<maxBars;offset+=limit){
      const count=Math.min(limit,maxBars-offset);
      pages.push({
        startTime:Math.floor(firstOpenTime-(offset+count)*step),
        endTime:Math.floor(firstOpenTime-offset*step-1),
        limit:count
      });
    }
    return pages;
  }

  async function fetchHistory(symbol,interval,maxBars,endTime,signal,market){
    const m=market||'um',pageMax=maxLimit(m),requested=Math.max(1,Number(maxBars)||pageMax);
    if(interval==='1M'||requested<=pageMax||!intervalMsMap[interval]){
      return fetchHistorySerial(symbol,interval,maxBars,endTime,signal,market);
    }
    const end=Number.isFinite(endTime)?Number(endTime):Date.now();
    const firstParams=new URLSearchParams({
      symbol,interval,limit:String(pageMax),endTime:String(Math.floor(end))
    });
    const latestRaw=await requestJson(endpoint(m)+'?'+firstParams.toString(),4,signal);
    if(!Array.isArray(latestRaw)||!latestRaw.length)return[];
    const latest=parseRows(latestRaw);
    if(!latest.length)return[];
    if(latest.length<pageMax)return latest.slice(-requested);
    const earliest=latest[0].openTime;
    if(!Number.isFinite(earliest))return fetchHistorySerial(symbol,interval,maxBars,end,signal,market);
    const pages=parallelPagePlan(interval,requested-latest.length,earliest,m);
    const responses=await Promise.all(pages.map(page=>{
      const params=new URLSearchParams({
        symbol,interval,limit:String(page.limit),
        startTime:String(page.startTime),endTime:String(page.endTime)
      });
      return requestJson(endpoint(m)+'?'+params.toString(),4,signal);
    }));
    const dedup=new Map();
    for(const row of latest)dedup.set(row.time,row);
    for(const raw of responses)for(const row of parseRows(raw))dedup.set(row.time,row);
    const combined=[...dedup.values()].sort((a,b)=>a.time-b.time).slice(-requested);
    if(responses.some((raw,i)=>!Array.isArray(raw)||raw.length<pages[i].limit)||
       combined.length<requested){
      // Missing old bars: retain the exact cursor-based historical fallback.
      return fetchHistorySerial(symbol,interval,maxBars,end,signal,market);
    }
    return combined;
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

  // Requests are keyed by immutable deployment versions; both fulfilled and in-flight
  // responses are shared across template / symbol switches in the same tab.
  const assetCache=new Map();
  let statusCache=null,statusCheckedAt=0;
  const STATUS_TTL_MS=10*60*1000;
  const statusKeys={
    levels:'levelsGeneratedAt',tpo:'tpoGeneratedAt',
    profile:'profileGeneratedAt','macro/ssd':'ssdGeneratedAt'
  };
  async function versions(signal){
    if(statusCache&&Date.now()-statusCheckedAt<STATUS_TTL_MS)return statusCache;
    try{
      const r=await fetch('analysis/status.json',{cache:'no-store',signal});
      if(!r.ok)throw new Error('status HTTP '+r.status);
      statusCache=await r.json();
    }catch(e){
      if(isAbort(e,signal))throw e;
      statusCache=statusCache||{};
    }
    statusCheckedAt=Date.now();
    return statusCache;
  }
  function precomputedUrl(name,symbol,status){
    const key=name==='profile'?'profiles-'+symbol+'.json':
      name==='macro/ssd'?'analysis/macro/ssd.json':
      'analysis/'+name+'/'+symbol+'.json';
    const version=status&&status[statusKeys[name]];
    return key+(version?'?v='+encodeURIComponent(version):'');
  }
  async function fetchCached(url,signal){
    if(!assetCache.has(url)){
      const job=fetch(url,{cache:'default'}).then(r=>{
        if(!r.ok)throw new Error('HTTP '+r.status);
        return r.json();
      }).catch(err=>{assetCache.delete(url);throw err;});
      assetCache.set(url,job);
    }
    return assetCache.get(url);
  }
  async function fetchProfile(symbol,signal){
    try{return await fetchCached(precomputedUrl('profile',symbol,await versions(signal)),signal);}
    catch(e){if(isAbort(e,signal))throw e;return null;}
  }
  async function fetchKeyLevels(symbol,generatedAt,signal){
    return fetchCached(precomputedUrl('levels',symbol,{levelsGeneratedAt:generatedAt}),signal);
  }
  async function fetchTpo(symbol,generatedAt,signal){
    return fetchCached(precomputedUrl('tpo',symbol,{tpoGeneratedAt:generatedAt}),signal);
  }
  async function loadPrecomputed(symbol,requested,signal){
    const needs=[...new Set(requested||[])].filter(x=>statusKeys[x]);
    const result={profile:null,keyLevels:null,tpo:null,macro:null,errors:{},versions:{}};
    if(!needs.length)return result;
    const status=await versions(signal);
    const props={levels:'keyLevels',tpo:'tpo',profile:'profile','macro/ssd':'macro'};
    await Promise.all(needs.map(async name=>{
      const url=precomputedUrl(name,symbol,status);
      result.versions[name]=status[statusKeys[name]]||null;
      try{result[props[name]]=await fetchCached(url,signal);}
      catch(e){
        if(isAbort(e,signal))throw e;
        result.errors[name==='macro/ssd'?'macro':name]=
          name==='profile'?'profiles-'+symbol+'.json unavailable':
            String(e.message||e);
      }
    }));
    return result;
  }
  async function loadSnapshot(symbol,needs){
    const needed=(needs&&needs.precomputed)||['levels','tpo'];
    const [payload,assets]=await Promise.all([
      (async()=>{
        const r=await fetch('analysis/data/'+symbol+'.json',{cache:'no-store'});
        if(!r.ok)throw new Error('snapshot '+symbol+' HTTP '+r.status);
        return r.json();
      })(),
      loadPrecomputed(symbol,needed.filter(x=>x!=='profile'),null)
    ]);
    const series={},errors={...(payload.errors||{}),...assets.errors};
    for(const [key,value] of Object.entries(payload.series||{}))series[key]=parseRows(value);
    return{
      schema:payload.schema||'analysis-snapshot-v1',symbol,
      generatedAt:payload.generatedAt,cutoffUtc:payload.cutoffUtc,
      series,profile:payload.profile||null,
      keyLevels:assets.keyLevels,tpo:assets.tpo,errors,
      precomputedVersions:assets.versions
    };
  }

  function livePlan(timeframe,history){
    if(history&&history.requiredIntervals){
      const intervals=[],limits={};
      for(const [interval,value] of Object.entries(history.requiredIntervals)){
        const cap=Math.ceil(Number(value));
        if(!interval||!Number.isFinite(cap)||cap<=0)continue;
        intervals.push(interval);limits[interval]=cap;
      }
      if(!intervals.includes(timeframe)){
        intervals.unshift(timeframe);limits[timeframe]=displayCounts[timeframe]||500;
      }
      return{intervals,limits};
    }
    const required=timeframe==='1M'
      ?[timeframe,calcMap[timeframe],...Object.keys(history||{})]
      :[timeframe,'1h','30m',calcMap[timeframe],...Object.keys(history||{})];
    const intervals=[];for(const x of required)if(x&&!intervals.includes(x))intervals.push(x);
    const limits={};for(const interval of intervals)limits[interval]=capFor(interval,timeframe,history);
    return{intervals,limits};
  }

  async function loadLive(symbol,timeframe,onProgress,signal,history){
    const progress=typeof onProgress==='function'?onProgress:()=>{},errors={},series={};
    const plan=livePlan(timeframe,history);
    const {intervals,limits}=plan;
    const need=history&&history.precomputed||['profile','levels','tpo'];
    let done=0;const total=intervals.length+need.length;
    const step=label=>{done++;progress({done,total,label});};
    const timing={klinesMs:0,precomputedMs:0};
    const started=performance.now();
    const candles=Promise.all(intervals.map(interval=>
      fetchHistory(symbol,interval,limits[interval],undefined,signal)
        .then(value=>{series[interval]=value;step(interval);})
        .catch(e=>{
          if(isAbort(e,signal))throw e;
          errors[interval]=String(e.message||e);step(interval+' failed');
        })
    )).finally(()=>{timing.klinesMs=performance.now()-started;});
    const preStart=performance.now();
    const assetsJob=loadPrecomputed(symbol,need,signal)
      .finally(()=>{timing.precomputedMs=performance.now()-preStart;});
    const [,assets]=await Promise.all([candles,assetsJob]);
    Object.assign(errors,assets.errors);
    if(!(series[timeframe]||[]).length)throw new Error(errors[timeframe]||'display candles unavailable');
    const generatedAt=new Date().toISOString();
    return{
      schema:'analysis-live-v2',symbol,generatedAt,cutoffUtc:null,
      series,profile:assets.profile,keyLevels:assets.keyLevels,tpo:assets.tpo,
      errors,precomputedVersions:assets.versions,timing
    };
  }

  async function refreshLiveBundle(bundle,symbol,timeframe,signal,history){
    const {intervals,limits}=livePlan(timeframe,history);
    const failures=[],updates={},fullIntervals=new Set(),errors={...(bundle&&bundle.errors||{})};
    const started=performance.now(),timing={klinesMs:0,precomputedMs:0};
    const candleJob=Promise.all(intervals.map(async interval=>{
      const cap=limits[interval],existing=(bundle&&bundle.series&&bundle.series[interval])||[];
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
    })).finally(()=>{timing.klinesMs=performance.now()-started;});
    const preStart=performance.now();
    const need=history&&history.precomputed||['profile','levels','tpo'];
    const preJob=loadPrecomputed(symbol,need,signal)
      .finally(()=>{timing.precomputedMs=performance.now()-preStart;});
    const [,assets]=await Promise.all([candleJob,preJob]);
    const series={...(bundle&&bundle.series||{})};
    for(const interval of intervals){
      if(!updates[interval])continue;
      series[interval]=fullIntervals.has(interval)
        ?updates[interval]
        :mergeBars(series[interval]||[],updates[interval],limits[interval]);
    }
    for(const name of ['profile','levels','tpo']){
      if(!need.includes(name))delete errors[name];
    }
    for(const key of Object.keys(assets.errors)){
      errors[key]=assets.errors[key];
      failures.push({interval:key,error:assets.errors[key]});
    }
    for(const key of ['profile','levels','tpo'])if(need.includes(key)&&!assets.errors[key])delete errors[key];
    return{
      bundle:{
        ...(bundle||{}),schema:'analysis-live-v2',symbol,
        generatedAt:new Date().toISOString(),series,
        profile:assets.profile,keyLevels:assets.keyLevels,tpo:assets.tpo,
        errors,precomputedVersions:assets.versions,timing
      },failures
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
    intervalMs,intervalSec,displayCounts,calcMap,parseRows,closedBars,fetchHistory,fetchHistorySerial,parallelPagePlan,fetchLatest,mergeBars,capFor,
    fetchProfile,fetchKeyLevels,fetchTpo,loadPrecomputed,versions,loadSnapshot,loadLive,refreshLiveBundle,formatJst,toDisplayTime,formatDisplayTime,formatDisplayTick
  };
})(typeof globalThis!=='undefined'?globalThis:window);
