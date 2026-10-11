import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function harness(){
  const calls=[];
  const records={levelsGeneratedAt:'v1',tpoGeneratedAt:'w1',profileGeneratedAt:'p1',ssdGeneratedAt:'s1'};
  let currentTime=1_000_000;
  class Clock extends Date{static now(){return currentTime;}}
  const fakeFetch=async(url,opts={})=>{
    calls.push({url:String(url),cache:opts.cache});
    if(url==='analysis/status.json')return{ok:true,json:async()=>({...records})};
    return{ok:true,json:async()=>({url:String(url),values:[1,2,3]})};
  };
  const context=vm.createContext({fetch:fakeFetch,Date:Clock,performance:{now:()=>0},
    URLSearchParams,Map,Set,Promise,AbortController});
  const code=fs.readFileSync(new URL('../analysis/data.js',import.meta.url),'utf8');
  vm.runInContext(code,context);
  return{api:context.OrderFlowAnalysisData,calls,records,advance:ms=>{currentTime+=ms;}};
}

test('D20b1 only loads declared assets and reuses identical URLs in same tab',async()=>{
  const h=harness();
  const a=await h.api.loadPrecomputed('BTCUSDT',['levels']);
  assert.ok(a.keyLevels);
  assert.equal(a.profile,null);
  assert.deepEqual(h.calls.map(x=>x.url),['analysis/status.json','analysis/levels/BTCUSDT.json?v=v1']);
  await h.api.loadPrecomputed('BTCUSDT',['levels']);
  assert.equal(h.calls.length,2);
  await h.api.loadPrecomputed('ETHUSDT',['levels']);
  assert.equal(h.calls.length,3);
  assert.equal(h.calls[2].url,'analysis/levels/ETHUSDT.json?v=v1');
  assert.ok(h.calls.every(x=>x.url==='analysis/status.json'?x.cache==='no-store':x.cache==='default'));
});

test('D20b1 refreshes precomputed JSON only when status version changes',async()=>{
  const h=harness();
  await h.api.loadPrecomputed('BTCUSDT',['tpo','profile']);
  assert.equal(h.calls.length,3);
  h.advance(600_001);
  await h.api.loadPrecomputed('BTCUSDT',['tpo','profile']);
  assert.equal(h.calls.length,4);
  h.records.tpoGeneratedAt='w2';
  h.advance(600_001);
  await h.api.loadPrecomputed('BTCUSDT',['tpo','profile']);
  assert.equal(h.calls.length,6);
  assert.ok(h.calls.some(x=>x.url==='analysis/tpo/BTCUSDT.json?v=w2'));
  assert.equal(h.calls.filter(x=>x.url==='profiles-BTCUSDT.json?v=p1').length,1);
});
