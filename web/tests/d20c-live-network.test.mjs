import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function harness(responder){
  const calls=[],pauses=[],intervals=[];
  const response=(status,headers={})=>({
    ok:status>=200&&status<300,status,
    headers:{get:key=>headers[key]??null},
    json:async()=>({ok:true})
  });
  const fetch=async(url,opts)=>{
    calls.push({url:String(url),signal:opts.signal});
    return responder(url,opts,calls.length,response);
  };
  const context=vm.createContext({
    fetch,AbortController,URLSearchParams,Map,Set,Promise,Date,
    performance:{now:()=>0},setTimeout:(fn,ms)=>{pauses.push(ms);queueMicrotask(fn);return 1;},
    clearTimeout:()=>{},setInterval:(fn,ms)=>{intervals.push(ms);return 9;},
    clearInterval:()=>{},Event,
    dispatchEvent:()=>{}
  });
  vm.runInContext(fs.readFileSync(new URL('../analysis/data.js',import.meta.url),'utf8'),context);
  return{api:context.OrderFlowAnalysisData,calls,pauses,intervals,response};
}
const url='https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1h';

for(const [name,code] of [['network/CORS TypeError',null],['HTTP 451',451],['HTTP 403',403]]){
  test('D20c-1 '+name+' stops after initial request and one retry',async()=>{
    const h=harness(async(_url,_options,_index,reply)=>{
      if(code===null)throw new TypeError('Failed to fetch');
      return reply(code);
    });
    await assert.rejects(h.api.requestJson(url,4),e=>h.api.isLiveUnavailable(e));
    assert.equal(h.calls.length,2);
    assert.deepEqual(h.pauses,[300]);
    assert.equal(h.api.getLiveAvailability().unavailable,true);
    await assert.rejects(h.api.requestJson(url,4),e=>h.api.isLiveUnavailable(e));
    assert.equal(h.calls.length,2,'offline tab must not re-request klines');
    assert.deepEqual(h.intervals,[300000]);
  });
}

for(const code of [418,429,500,503]){
  test('D20c-1 HTTP '+code+' retains normal backoff and never marks live unavailable',async()=>{
    const h=harness(async(_url,_opts,_attempt,reply)=>reply(code));
    await assert.rejects(h.api.requestJson(url,4),new RegExp('HTTP '+code));
    assert.equal(h.calls.length,4);
    assert.equal(h.api.getLiveAvailability().unavailable,false);
    assert.deepEqual(h.pauses,code===418||code===429?[1000,2000,4000]:[500,1000,2000]);
  });
}

test('D20c-1 AbortError triggered by browser timeout uses transient retries',async()=>{
  const h=harness(async()=>{const e=new Error('timeout');e.name='AbortError';throw e;});
  await assert.rejects(h.api.requestJson(url,4),/timeout/);
  assert.equal(h.calls.length,4);
  assert.deepEqual(h.pauses,[500,1000,2000]);
  assert.equal(h.api.getLiveAvailability().unavailable,false);
});

test('D20c-1 one blocked request aborts sibling Binance network requests',async()=>{
  let slowRequests=0;
  const h=harness(async(url,opts,index,reply)=>{
    if(String(url).includes('interval=4h')){
      slowRequests++;
      return new Promise((_resolve,reject)=>{
        const onAbort=()=>{const error=new Error('Aborted');error.name='AbortError';reject(error);};
        opts.signal.addEventListener('abort',onAbort,{once:true});
      });
    }
    return reply(451);
  });
  const a=h.api.requestJson(url,4);
  const b=h.api.requestJson(url.replace('interval=1h','interval=4h'),4);
  const results=await Promise.allSettled([a,b]);
  assert.equal(results.length,2);
  assert.ok(results.every(r=>r.status==='rejected'&&h.api.isLiveUnavailable(r.reason)));
  assert.equal(h.api.getLiveAvailability().unavailable,true);
  assert.equal(slowRequests,1);
  assert.equal(h.calls.length,3);
});

test('D20c-1 explicit recovery probe clears the tab-wide circuit breaker',async()=>{
  let restore=false;
  const h=harness(async(url,_opts,_attempt,reply)=>{
    if(String(url).endsWith('/fapi/v1/time'))return reply(restore?200:451);
    return reply(restore?200:451);
  });
  await assert.rejects(h.api.requestJson(url,4),e=>h.api.isLiveUnavailable(e));
  assert.equal(h.api.getLiveAvailability().unavailable,true);
  assert.equal(await h.api.probeLive(),false);
  assert.equal(h.api.getLiveAvailability().unavailable,true);
  restore=true;
  assert.equal(await h.api.probeLive(),true);
  assert.equal(h.api.getLiveAvailability().unavailable,false);
  await h.api.requestJson(url,4);
});
