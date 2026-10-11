import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const hour=3_600_000,start=Date.UTC(2025,0,1);
function bars(withGap=false){
  return Array.from({length:5300},(_,i)=>{
    const open=start+i*hour,price=100+i/50;
    return [open,String(price),String(price+1),String(price-1),String(price+.3),
      '100',open+hour-1,'10000',20,'40','4000','0'];
  }).filter((_,i)=>!withGap||i%400!==5);
}
function client(withGap=false){
  const data=bars(withGap);
  let concurrent=0,maxConcurrent=0;
  const requests=[];
  const fetch=async url=>{
    const u=new URL(String(url)),q=u.searchParams;
    concurrent++;maxConcurrent=Math.max(maxConcurrent,concurrent);
    await new Promise(r=>setTimeout(r,2));
    const end=Number(q.get('endTime'))||Infinity;
    const first=q.get('startTime')==null?-Infinity:Number(q.get('startTime'));
    const limit=Number(q.get('limit'))||500;
    const eligible=data.filter(x=>x[0]>=first&&x[0]<=end);
    // Binance with startTime returns the earliest eligible rows.
    const response=q.has('startTime')?eligible.slice(0,limit):eligible.slice(-limit);
    requests.push({start:first,end,limit});
    concurrent--;
    return{ok:true,json:async()=>response};
  };
  const context=vm.createContext({fetch,URLSearchParams,Date,Map,Set,Promise,
    setTimeout,clearTimeout,AbortController,performance});
  vm.runInContext(fs.readFileSync(new URL('../analysis/data.js',import.meta.url),'utf8'),context);
  return{api:context.OrderFlowAnalysisData,requests,getMaxConcurrent:()=>maxConcurrent,
    end:data.at(-1)[0]+hour/2};
}
const native=x=>JSON.parse(JSON.stringify(x));

test('D20b2 Binance pagination concurrently matches legacy sequential 5,000 bars',async()=>{
  const h=client(false);
  const [serial,parallel]=await Promise.all([
    h.api.fetchHistorySerial('BTCUSDT','1h',5000,h.end),
    h.api.fetchHistory('BTCUSDT','1h',5000,h.end)
  ]);
  assert.deepEqual(native(parallel),native(serial));
  assert.equal(parallel.length,5000);
  assert.ok(h.getMaxConcurrent()>=3);
  assert.equal(h.requests.filter(x=>Number.isFinite(x.start)).length,4);
});
test('D20b2 Binance paging falls back to cursor for historical gaps',async()=>{
  const h=client(true);
  const a=await h.api.fetchHistorySerial('BTCUSDT','1h',3500,h.end);
  const b=await h.api.fetchHistory('BTCUSDT','1h',3500,h.end);
  assert.deepEqual(native(b),native(a));
});
test('D20b2 monthly retains original window semantics',async()=>{
  const h=client(false);
  const a=await h.api.fetchHistorySerial('BTCUSDT','1M',120,h.end);
  const b=await h.api.fetchHistory('BTCUSDT','1M',120,h.end);
  assert.deepEqual(native(b),native(a));
});
