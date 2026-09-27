import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

await import(pathToFileURL(path.resolve('web/analysis/engine.js')));
await import(pathToFileURL(path.resolve('web/analysis/data.js')));
const E=globalThis.OrderFlowAnalysisEngine;
const D=globalThis.OrderFlowAnalysisData;

const cfg={
  impulseMaxBars:3,impulseMinMoveAtr:1.5,impulseMinBodyPct:.5,requireDeltaAlign:true,
  baseMaxBars:5,baseMaxRangeAtr:1,maxAgeBars:300,perSide:2,maxDistancePct:20
};

test('D2-1 aligns 1h VWAP to 4h display timestamps only',()=>{
  const points=[];
  for(let i=0;i<12;i++)points.push({time:i*3600,value:100+i});
  const bars=[{time:0},{time:14400},{time:28800}];
  const out=E.alignSeriesToBars(points,bars,14400);
  assert.deepEqual(out.map(x=>x.time),[0,14400,28800]);
  assert.deepEqual(out.map(x=>x.value),[103,107,111]);
  const allowed=new Set(bars.map(x=>x.time));
  assert.equal(out.every(x=>allowed.has(x.time)),true);
  assert.ok(out.length<=bars.length);
});

test('D2-3 stale previous-week profile is rejected',()=>{
  const last=Date.UTC(2026,8,24)/1000;
  const stale={profiles:{previous:{complete:true,expectedDays:['2026-09-07','2026-09-08']}}};
  const fresh={profiles:{previous:{complete:true,expectedDays:['2026-09-14','2026-09-15','2026-09-16','2026-09-17','2026-09-18','2026-09-19','2026-09-20']}}};
  assert.equal(E.profileIsFresh(stale,last),false);
  assert.equal(E.profileIsFresh(fresh,last),true);
});

test('D2-4 closedBars excludes unfinished candle',()=>{
  const bars=[
    {time:1,closeTime:1999,open:1,high:2,low:0,close:1},
    {time:2,closeTime:2999,open:1,high:9,low:-9,close:8}
  ];
  assert.deepEqual(D.closedBars(bars,2500).map(x=>x.time),[1]);
});

test('D2-4 changing unfinished OHLC cannot change detected zones or invalidate by close',()=>{
  const closed=[];
  for(let i=0;i<24;i++)closed.push({time:i,open:100,high:105,low:95,close:101,volume:10,takerBuyBase:5});
  closed.push({time:24,open:100,high:102,low:98,close:101,volume:10,takerBuyBase:5});
  closed.push({time:25,open:101,high:103,low:99,close:100,volume:10,takerBuyBase:5});
  closed.push({time:26,open:100,high:102,low:98,close:100,volume:10,takerBuyBase:5});
  closed.push({time:27,open:100,high:121,low:99,close:119,volume:10,takerBuyBase:9});
  const a=E.detectZones(closed,cfg);
  const liveA={time:28,open:119,high:120,low:117,close:118,volume:10,takerBuyBase:5};
  const liveB={time:28,open:119,high:130,low:80,close:80,volume:10,takerBuyBase:5};
  assert.deepEqual(E.detectZones(closed,cfg),a);
  assert.deepEqual(E.detectZones(closed,cfg),a);
  const withTouch=E.detectZones(closed,cfg,closed.concat([liveB]));
  assert.equal(withTouch.some(z=>z.type==='demand'&&z.valid!==false),true);
  assert.equal(liveA.time,liveB.time);
});

test('D2-5 supply states inside ahead breaking',()=>{
  const base={type:'supply',bottom:98,top:102,strength:2,tested:false,ageBars:1,from:1,created:2};
  assert.equal(E.selectZones([base],100,cfg)[0].zoneState,'inside');
  assert.equal(E.selectZones([{...base,bottom:110,top:112}],100,cfg)[0].zoneState,'ahead');
  assert.equal(E.selectZones([{...base,bottom:90,top:95}],100,cfg)[0].zoneState,'breaking');
});

test('D2-5 demand states inside ahead breaking',()=>{
  const base={type:'demand',bottom:98,top:102,strength:2,tested:false,ageBars:1,from:1,created:2};
  assert.equal(E.selectZones([base],100,cfg)[0].zoneState,'inside');
  assert.equal(E.selectZones([{...base,bottom:88,top:90}],100,cfg)[0].zoneState,'ahead');
  assert.equal(E.selectZones([{...base,bottom:105,top:110}],100,cfg)[0].zoneState,'breaking');
});

test('D2-8 view filters reject far lines and zones',()=>{
  assert.equal(E.inPriceView(100,90,110,10),true);
  assert.equal(E.inPriceView(150,90,110,10),false);
  assert.equal(E.zoneIntersectsView({bottom:108,top:120},90,110,50),true);
  assert.equal(E.zoneIntersectsView({bottom:150,top:160},90,110,50),false);
});
