(function (global) {
  'use strict';

  const JST = 'Asia/Tokyo';
  const cache = new Map();
  const exactProfileCache = new Map();
  const intervalMsMap = {
    '15m': 15 * 60 * 1000,
    '30m': 30 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '2h': 2 * 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
  };

  function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
  function intervalMs(interval) { return intervalMsMap[interval] || 60 * 60 * 1000; }
  function intervalSec(interval) { return Math.floor(intervalMs(interval) / 1000); }
  function intervalLabel(interval) {
    return ({'15m':'15分钟','30m':'30分钟','1h':'1小时','2h':'2小时','4h':'4小时','1d':'1天'})[interval] || interval;
  }

  function asDate(time) {
    if (typeof time === 'number') return new Date(time * 1000);
    if (time && typeof time === 'object' && 'year' in time) return new Date(Date.UTC(time.year, time.month - 1, time.day));
    return new Date(NaN);
  }

  function localTimeZone() { return JST; }

  function formatLocalDateTime(time, withSeconds) {
    const date = asDate(time);
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat('ja-JP', {
      timeZone: JST, year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', second:withSeconds ? '2-digit' : undefined,
      hour12:false,
    }).format(date);
  }

  function normalizeTickType(tickMarkType) {
    if (typeof tickMarkType === 'string') return tickMarkType.toLowerCase();
    return ({0:'year',1:'month',2:'dayofmonth',3:'time',4:'timewithseconds'})[tickMarkType] || 'time';
  }

  function formatLocalTick(time, tickMarkType, locale) {
    const date = asDate(time);
    if (!Number.isFinite(date.getTime())) return '';
    const type = normalizeTickType(tickMarkType);
    const loc = locale || 'ja-JP';
    if (type === 'year') { const p=Object.fromEntries(new Intl.DateTimeFormat(loc,{timeZone:JST,year:'numeric'}).formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,x.value])); return p.year; }
    const parts=(opts)=>Object.fromEntries(new Intl.DateTimeFormat(loc,{timeZone:JST,...opts,hour12:false}).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
    if (type === 'month') { const p=parts({month:'numeric'}); return p.month+'月'; }
    if (type === 'dayofmonth' || type === 'day') { const p=parts({month:'2-digit',day:'2-digit'}); return p.month+'/'+p.day; }
    const p=parts({hour:'2-digit',minute:'2-digit',second:type==='timewithseconds'?'2-digit':undefined});
    return p.hour+':'+p.minute+(type==='timewithseconds'?':'+p.second:'');
  }

  function remainingText(closeTimeMs, nowMs) {
    const remaining = Math.max(0, Number(closeTimeMs) - Number(nowMs));
    const totalSeconds = Math.floor(remaining / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n) => String(n).padStart(2,'0');
    return hours > 0 ? pad(hours)+':'+pad(minutes)+':'+pad(seconds) : pad(minutes)+':'+pad(seconds);
  }

  function endpoint(market) { return market === 'spot' ? 'https://api.binance.com/api/v3/klines' : 'https://fapi.binance.com/fapi/v1/klines'; }
  function maxLimit(market) { return market === 'spot' ? 1000 : 1500; }

  function parseKlines(rows) {
    return rows.map((row) => ({
      time: Math.floor(Number(row[0]) / 1000),
      openTime:Number(row[0]), closeTime:Number(row[6]),
      open:Number(row[1]), high:Number(row[2]), low:Number(row[3]), close:Number(row[4]),
      volume:Number(row[5]), quoteVolume:Number(row[7]), trades:Number(row[8]), takerBuyBase:Number(row[9]),
    })).filter((x) => Number.isFinite(x.time) && Number.isFinite(x.open) && Number.isFinite(x.close));
  }

  async function requestJson(url, retries) {
    let lastError = null;
    for (let attempt=0; attempt<retries; attempt+=1) {
      let response;
      try { response = await fetch(url,{cache:'no-store'}); }
      catch(error) {
        lastError=error;
        if (attempt+1<retries) await sleep(500*(2**attempt));
        continue;
      }
      if (response.ok) return response.json();
      if (response.status===429 || response.status===418) {
        const retryAfter=Number(response.headers.get('Retry-After'));
        const waitMs=Number.isFinite(retryAfter)&&retryAfter>0 ? retryAfter*1000 : 1000*(2**attempt);
        lastError=new Error('HTTP '+response.status);
        if (attempt+1<retries) await sleep(waitMs);
        continue;
      }
      throw new Error('HTTP '+response.status);
    }
    throw lastError || new Error('request failed');
  }

  function validateKlineContinuity(rows, interval) {
    const expected=intervalMs(interval);
    const gaps=[];
    for(let i=1;i<rows.length;i+=1){
      const delta=(rows[i].time-rows[i-1].time)*1000;
      if(delta!==expected){
        gaps.push({from:rows[i-1].time,to:rows[i].time,deltaMs:delta,missingBars:Math.max(0,Math.round(delta/expected)-1)});
      }
    }
    return {ok:gaps.length===0,gaps};
  }

  function cacheKey(options,limit){ return [options.market||'um',options.symbol,options.interval||'1h',limit].join('|'); }
  function cacheEntryFresh(entry,interval,nowMs) {
    if(!entry) return false;
    return nowMs-entry.fetchedAt < intervalMs(interval);
  }

  async function fetchKlines(options) {
    const market=options.market||'um', symbol=options.symbol, interval=options.interval||'1h';
    const limit=Math.min(Number(options.limit)||maxLimit(market),maxLimit(market));
    const key=cacheKey(options,limit), now=Date.now(), entry=cache.get(key);
    if(!options.force && cacheEntryFresh(entry,interval,now)) return entry.data.slice();

    const params=new URLSearchParams({symbol,interval,limit:String(limit)});
    if(Number.isFinite(options.startTime)) params.set('startTime',String(Math.floor(options.startTime)));
    if(Number.isFinite(options.endTime)) params.set('endTime',String(Math.floor(options.endTime)));
    const rows=await requestJson(endpoint(market)+'?'+params.toString(),4);
    if(!Array.isArray(rows)||rows.length===0) throw new Error('empty kline response');
    const parsed=parseKlines(rows);
    cache.set(key,{data:parsed,fetchedAt:now});
    return parsed.slice();
  }

  async function fetchKlineHistory(options) {
    const market=options.market||'um', interval=options.interval||'1h';
    const perPage=maxLimit(market), maxBars=Math.max(1,Number(options.maxBars)||perPage);
    let endTime=Number.isFinite(options.endTime)?Number(options.endTime):Date.now();
    const all=[];
    while(all.length<maxBars){
      const limit=Math.min(perPage,maxBars-all.length);
      const params=new URLSearchParams({symbol:options.symbol,interval,limit:String(limit),endTime:String(Math.floor(endTime))});
      const raw=await requestJson(endpoint(market)+'?'+params.toString(),4);
      if(!Array.isArray(raw)||raw.length===0) break;
      const page=parseKlines(raw);
      all.unshift(...page);
      const earliest=page[0] && page[0].openTime;
      if(!Number.isFinite(earliest) || page.length<limit) break;
      endTime=earliest-1;
    }
    const dedup=new Map();
    for(const bar of all) dedup.set(bar.time,bar);
    return Array.from(dedup.values()).sort((a,b)=>a.time-b.time).slice(-maxBars);
  }

  async function fetchLatest(options) {
    const market=options.market||'um';
    const params=new URLSearchParams({symbol:options.symbol,interval:options.interval||'1h',limit:'2'});
    const rows=await requestJson(endpoint(market)+'?'+params.toString(),3);
    return parseKlines(rows);
  }

  async function loadFixtureCandles(id) {
    const response=await fetch('web/chart/fixtures/'+id+'.candles.json',{cache:'no-store'});
    if(!response.ok) throw new Error('fixture candles '+id+' HTTP '+response.status);
    const payload=await response.json();
    const rows=Array.isArray(payload)?payload:payload.rows;
    if(!Array.isArray(rows)||!rows.length) throw new Error('fixture candles empty: '+id);
    return parseKlines(rows);
  }

  async function fetchExactProfiles(symbol) {
    if(exactProfileCache.has(symbol)) return exactProfileCache.get(symbol);
    try{
      const response=await fetch('profiles-'+symbol+'.json',{cache:'no-store'});
      if(!response.ok) throw new Error('HTTP '+response.status);
      const payload=await response.json();
      exactProfileCache.set(symbol,payload);
      return payload;
    }catch(error){
      console.warn('exact profile unavailable',symbol,error);
      exactProfileCache.set(symbol,null);
      return null;
    }
  }

  function displayCode(symbol,market){ return market==='spot'?symbol:symbol+'.P'; }
  function clearCache(){ cache.clear(); exactProfileCache.clear(); }

  global.OrderFlowChartData={
    JST,intervalMs,intervalSec,intervalLabel,localTimeZone,formatLocalDateTime,formatLocalTick,remainingText,
    fetchKlines,fetchKlineHistory,fetchLatest,loadFixtureCandles,fetchExactProfiles,
    displayCode,parseKlines,validateKlineContinuity,cacheEntryFresh,clearCache,_cache:cache
  };
})(typeof globalThis!=='undefined'?globalThis:window);
