(function(global){
  'use strict';
  const D=global.OrderFlowAnalysisData;

  function isAbort(e,signal){return !!(signal&&signal.aborted)||!!(e&&e.name==='AbortError');}
  function historyCap(manualAnchorMs){
    const base=21*96+16;
    if(!Number.isFinite(manualAnchorMs))return base;
    const age=Math.ceil((Date.now()-Number(manualAnchorMs))/900000)+16;
    return Math.max(base,age);
  }
  async function fetchDepth(symbol,signal){
    const r=await fetch('flow/data/depth-'+symbol+'.json',{cache:'no-store',signal});
    if(!r.ok)throw new Error('depth '+symbol+' HTTP '+r.status);
    return r.json();
  }
  async function fetchAnalysisSnapshot1h(symbol,signal){
    const r=await fetch('analysis/data/'+symbol+'.json',{cache:'no-store',signal});
    if(!r.ok)return[];
    const p=await r.json();
    return D.parseRows((p.series&&p.series['1h'])||[]);
  }
  async function loadSnapshot(symbol,signal){
    const r=await fetch('flow/data/'+symbol+'.json',{cache:'no-store',signal});
    if(!r.ok)throw new Error('flow snapshot '+symbol+' HTTP '+r.status);
    const p=await r.json();
    let depth=null,perp1h=[];
    try{depth=await fetchDepth(symbol,signal);}catch(e){if(isAbort(e,signal))throw e;}
    try{perp1h=await fetchAnalysisSnapshot1h(symbol,signal);}catch(e){if(isAbort(e,signal))throw e;}
    return{
      schema:p.schema||'flow-snapshot-v1',symbol,generatedAt:p.generatedAt,cutoffUtc:p.cutoffUtc,
      perp15m:D.parseRows(p.perp15m||[]),spot15m:D.parseRows(p.spot15m||[]),perp1h,depth,
      errors:depth?{}:{depth:'archived depth unavailable'}
    };
  }
  async function loadLive(symbol,anchorMode,manualAnchorMs,onProgress,signal){
    const progress=typeof onProgress==='function'?onProgress:()=>{},errors={};
    const cap=historyCap(manualAnchorMs);let done=0;const total=anchorMode==='quarter'?4:3;
    const step=label=>{done++;progress({done,total,label});};
    let perp15m=[],spot15m=[],perp1h=[],depth=null;
    await Promise.all([
      D.fetchHistory(symbol,'15m',cap,undefined,signal,'um').then(v=>{perp15m=v;step('perp 15m');}).catch(e=>{if(isAbort(e,signal))throw e;errors.perp=String(e.message||e);step('perp failed');}),
      D.fetchHistory(symbol,'15m',cap,undefined,signal,'spot').then(v=>{spot15m=v;step('spot 15m');}).catch(e=>{if(isAbort(e,signal))throw e;errors.spot=String(e.message||e);step('spot failed');}),
      fetchDepth(symbol,signal).then(v=>{depth=v;step('depth archive');}).catch(e=>{if(isAbort(e,signal))throw e;errors.depth=String(e.message||e);step('depth failed');}),
      ...(anchorMode==='quarter'?[D.fetchHistory(symbol,'1h',2300,undefined,signal,'um').then(v=>{perp1h=v;step('perp 1h');}).catch(e=>{if(isAbort(e,signal))throw e;errors.perp1h=String(e.message||e);step('1h failed');})]:[])
    ]);
    if(!perp15m.length)throw new Error(errors.perp||'perp 15m unavailable');
    return{schema:'flow-live-v1',symbol,generatedAt:new Date().toISOString(),cutoffUtc:null,perp15m,spot15m,perp1h,depth,errors,cap};
  }
  async function refreshLiveBundle(bundle,symbol,anchorMode,manualAnchorMs,signal){
    const errors={...(bundle&&bundle.errors||{})},failures=[];
    const cap=historyCap(manualAnchorMs);
    const update=async(market,key)=>{
      const existing=(bundle&&bundle[key])||[],needsFull=!!errors[key]||existing.length<Math.min(cap,500)*.5;
      try{
        const rows=needsFull?await D.fetchHistory(symbol,'15m',cap,undefined,signal,market):await D.fetchLatest(symbol,'15m',3,signal,market);
        delete errors[key];
        return needsFull?rows:D.mergeBars(existing,rows,cap);
      }catch(e){if(isAbort(e,signal))throw e;failures.push({interval:key,error:String(e.message||e)});return existing;}
    };
    const [perp15m,spot15m]=await Promise.all([update('um','perp15m'),update('spot','spot15m')]);
    let depth=bundle&&bundle.depth||null;
    if(!depth||errors.depth){
      try{depth=await fetchDepth(symbol,signal);delete errors.depth;}
      catch(e){if(isAbort(e,signal))throw e;errors.depth=String(e.message||e);failures.push({interval:'depth',error:errors.depth});}
    }
    let perp1h=bundle&&bundle.perp1h||[];
    if(anchorMode==='quarter'&&!perp1h.length){
      try{perp1h=await D.fetchHistory(symbol,'1h',2300,undefined,signal,'um');delete errors.perp1h;}
      catch(e){if(isAbort(e,signal))throw e;errors.perp1h=String(e.message||e);failures.push({interval:'perp1h',error:errors.perp1h});}
    }
    return{bundle:{...(bundle||{}),schema:'flow-live-v1',symbol,generatedAt:new Date().toISOString(),perp15m,spot15m,perp1h,depth,errors,cap},failures};
  }

  global.OrderFlowFlowData={historyCap,loadSnapshot,loadLive,refreshLiveBundle};
})(typeof globalThis!=='undefined'?globalThis:window);
