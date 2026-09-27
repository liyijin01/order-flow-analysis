import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

await import(pathToFileURL(path.resolve('web/chart/data.js')));
await import(pathToFileURL(path.resolve('web/chart/realtime.js')));
await import(pathToFileURL(path.resolve('web/chart/render/primitives/base.js')));
await import(pathToFileURL(path.resolve('web/chart/render/primitives/profile.js')));

const D=globalThis.OrderFlowChartData;
const R=globalThis.OrderFlowRealtime;
const Base=globalThis.OrderFlowPrimitiveBase.AnnotationPrimitiveBase;
const profileGeometry=globalThis.OrderFlowProfileGeometry;

test('F1 historical latest update does not block current candle',()=>{
  const existing=[{time:100},{time:200}];
  const latest=[
    {time:100,open:1,high:2,low:.5,close:1.5,volume:10},
    {time:200,open:2,high:3,low:1.5,close:2.8,volume:20},
  ];
  const calls=[];
  const fake={update:(bar,historical)=>{if(bar.time<200&&!historical)throw new Error('Cannot update oldest data');calls.push([bar.time,!!historical]);}};
  const result=R.applyLatestUpdates({existing,latest,intervalSec:100,candleSeries:fake,volumeSeries:fake,volumeUp:'u',volumeDown:'d'});
  assert.equal(result.errors.length,0);
  assert.deepEqual(calls.filter((_,i)=>i%2===0),[[100,true],[200,false]]);
  assert.ok(result.updated.some(x=>x.time===200&&!x.historical));
});

test('F2 stale cache expires within one interval and gaps are detected',()=>{
  const entry={fetchedAt:1_000,data:[]};
  assert.equal(D.cacheEntryFresh(entry,'1h',1_000+3_599_999),true);
  assert.equal(D.cacheEntryFresh(entry,'1h',1_000+3_600_000),false);
  const rows=[{time:0},{time:3600},{time:10800}];
  const v=D.validateKlineContinuity(rows,'1h');
  assert.equal(v.ok,false);assert.equal(v.gaps.length,1);assert.equal(v.gaps[0].missingBars,1);
  assert.equal(R.planLatestUpdates([{time:0},{time:3600}],[{time:10800}],3600).reloadRequired,true);
});

test('F3 tick formatter covers five tick mark types in Asia/Tokyo',()=>{
  const t=Date.UTC(2026,0,2,3,4,5)/1000;
  assert.equal(D.localTimeZone(),'Asia/Tokyo');
  assert.match(D.formatLocalTick(t,0,'ja-JP'),/^\d{4}$/);
  assert.match(D.formatLocalTick(t,1,'ja-JP'),/^\d{1,2}月$/);
  assert.match(D.formatLocalTick(t,2,'ja-JP'),/^\d{2}\/\d{2}$/);
  assert.match(D.formatLocalTick(t,3,'ja-JP'),/^\d{2}:\d{2}$/);
  assert.match(D.formatLocalTick(t,4,'ja-JP'),/^\d{2}:\d{2}:\d{2}$/);
  assert.match(D.formatLocalDateTime(t,false),/2026/);
});

test('F5 x coordinate handles off-grid, future extrapolation and early clamp',()=>{
  const bars=[{time:1020},{time:1080},{time:1140}];
  const scale={
    timeToIndex:(t)=>({1020:0,1080:1,1140:2}[t] ?? null),
    logicalToCoordinate:(i)=>i*10,
  };
  const p=new Base({id:'x',type:'text',time:1080,price:1,text:'x'});
  p.setContext({bars,intervalSec:60});p.chart={timeScale:()=>scale};p.series={priceToCoordinate:()=>10};
  assert.equal(p.x(1105,100),10);
  assert.equal(p.x(1260,100),40);
  assert.equal(p.x(900,100),0);
  assert.equal(p._lastClamp,true);
});

test('F8 profile bins use lower edge and maxWidthBars caps width',()=>{
  assert.deepEqual(profileGeometry(1000,6,40),240);
  assert.deepEqual(profileGeometry(100,6,40),100);
  const P=globalThis.OrderFlowAnnotationPrimitives.profile;
  const p=new P({id:'p',type:'profile',from:1,to:2,binSize:5,rows:[[100,2],[105,3]],poc:102.5,vah:110,val:100});
  assert.deepEqual(p.debugProfile().bins,[{bottom:100,top:105},{bottom:105,top:110}]);
});
