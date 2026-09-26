import test from 'node:test';
import assert from 'node:assert/strict';
await import('../core.js');
const C=globalThis.OrderFlowCore;

test('maker side semantics and existing live binning',()=>{
  const a=C.normalizeAggTrade({a:'1',T:'1000',p:'100.5',q:'2',m:true});
  assert.deepEqual(a,{id:1,t:1000,p:100.5,q:2,m:true});
  const r=C.analyzeTrades([
    {id:1,t:1000,p:100.2,q:2,m:false},
    {id:2,t:1100,p:109.9,q:1,m:true},
    {id:3,t:1200,p:110,q:4,m:false},
  ],10,1000);
  assert.deepEqual(r.rows[0],[100,{buy:2,sell:1}]);
  assert.equal(r.delta,5);
});

test('minMax handles one million values without argument spreading',()=>{
  const values=new Array(1_000_000);
  for(let i=0;i<values.length;i+=1)values[i]=i-500000;
  assert.deepEqual(C.minMax(values),{min:-500000,max:499999});
});

test('300k trades bucketCvd stays at or below 5000 points',()=>{
  const events=new Array(300000);
  for(let i=0;i<events.length;i+=1)events[i]={id:i+1,t:i*1000,p:100,q:1,m:(i%2===0)};
  const out=C.bucketCvd(events,1000,5000);
  assert.ok(out.length<=5000);
  assert.ok(out.length>0);
});

test('gap detection identifies 3 through 4',()=>{
  assert.deepEqual(C.detectGaps([{id:1,t:1},{id:2,t:2},{id:5,t:5}]),[{fromId:3,toId:4,afterT:2,beforeT:5}]);
});

test('out of order and duplicate ids merge to ordered unique sequence',()=>{
  const out=C.mergeUniqueById([{id:3,t:3},{id:1,t:1}],[{id:2,t:2},{id:3,t:99}]);
  assert.deepEqual(out.map(x=>x.id),[1,2,3]);
  assert.equal(out[2].t,3);
});

test('footprint clipping is centered around latest price',()=>{
  const prices=[];for(let i=0;i<200;i+=1)prices.push(i);
  const out=C.clipFootprintPrices(prices,100,80);
  assert.equal(out.length,80);
  assert.ok(out.includes(100));
  assert.ok(out[0]>100 && out[out.length-1]<100);
});

test('decimal ladder rebin uses integer arithmetic',()=>{
  assert.equal(C.rebinIndex(42,'0.01','0.1'),4);
  assert.equal(C.rebinIndex(5371,'0.0001','0.01'),53);
});

test('coverage reports truncation and unresolved gaps',()=>{
  const s=C.coverageText([{t:0},{t:60000}],14400000,String,String,{truncated:true,gaps:[{fromId:3,toId:4}]});
  assert.match(s,/truncated/);
  assert.match(s,/3-4/);
});
