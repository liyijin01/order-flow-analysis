import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
await import(pathToFileURL(path.resolve('web/chart/indicators.js')));
const I=globalThis.OrderFlowIndicators;

test('C3 anchored VWAP and sigma match hand calculation',()=>{
  const bars=[
    {time:1,high:2,low:2,close:2,volume:1},
    {time:2,high:4,low:4,close:4,volume:1},
  ];
  const p=I.anchoredVwap(bars,1,1).at(-1);
  assert.ok(Math.abs(p.vwap-3)<1e-12);assert.ok(Math.abs(p.sigma-1)<1e-12);
  assert.ok(Math.abs(p.upper-4)<1e-12);assert.ok(Math.abs(p.lower-2)<1e-12);
});

test('C3 value area POC tie chooses bin midpoint nearest profile midpoint',()=>{
  const v=I.valueArea([[0,5],[1,1],[2,5]],1,.70);
  assert.equal(v.pocLower,2);
  assert.equal(v.poc,2.5);
});

test('C3 single prints exclude both edge tails',()=>{
  const r=I.singlePrintRanges([[0,1],[1,2],[2,1],[3,2],[4,1]],1,1);
  assert.deepEqual(r,[{bottom:2,top:3,count:1}]);
});

test('C3 TPO counts 30m ranges and emits value area',()=>{
  const bars=[
    {time:0,low:100,high:102,close:101,volume:1},
    {time:1800,low:101,high:103,close:102,volume:1},
  ];
  const p=I.tpoProfiles(bars,{binSize:1,group:'week',minBins:1})[0];
  assert.deepEqual(p.rows,[[100,1],[101,2],[102,2],[103,1]]);
  assert.ok(p.val<=p.poc&&p.poc<=p.vah);
});

test('C3 approximate VP conserves candle volume',()=>{
  const bars=[
    {low:100,high:102,volume:9,takerBuyBase:6},
    {low:101,high:103,volume:12,takerBuyBase:3},
  ];
  const p=I.approxVolumeProfile(bars,1);
  assert.ok(Math.abs(p.sourceVolume-21)<1e-9);
  assert.ok(Math.abs(p.distributedVolume-21)<1e-9);
  const rowsTotal=p.rows.reduce((a,r)=>a+r[3],0);
  assert.ok(Math.abs(rowsTotal-21)<1e-9);
});


test('D13 rolling VWAP excludes the exact left boundary and matches weighted window',()=>{
  const bars=[
    {time:0,high:10,low:10,close:10,volume:1},
    {time:10,high:20,low:20,close:20,volume:1},
    {time:20,high:30,low:30,close:30,volume:2},
  ];
  const out=I.rollingVwap(bars,20);
  assert.equal(out[0].value,null);
  assert.equal(out[1].value,null);
  assert.ok(Math.abs(out[2].value-(20*1+30*2)/3)<1e-12);
});

test('D13 rolling VWAP uses time window across gaps and returns null before full history',()=>{
  const bars=[
    {time:0,high:10,low:10,close:10,volume:1},
    {time:5,high:20,low:20,close:20,volume:1},
    {time:106,high:40,low:40,close:40,volume:1},
    {time:111,high:50,low:50,close:50,volume:1},
  ];
  const out=I.rollingVwap(bars,100);
  assert.equal(out[1].value,null);
  assert.ok(Math.abs(out[2].value-40)<1e-12);
  assert.ok(Math.abs(out[3].value-45)<1e-12);
});

test('D13 rolling VWAP matches anchored VWAP over the same complete window',()=>{
  const bars=[];
  for(let i=0;i<=10;i++)bars.push({time:i*10,high:100+i,low:98+i,close:99+i,volume:1+i});
  const window=50,last=bars.at(-1),inside=bars.filter(b=>b.time>last.time-window&&b.time<=last.time);
  const expected=I.anchoredVwap(inside,inside[0].time,1).at(-1).vwap;
  const actual=I.rollingVwap(bars,window).at(-1).value;
  assert.ok(Math.abs(actual-expected)<1e-12);
});

test('D13 rolling VWAP handles 3000 bars x four windows under 50ms',()=>{
  const bars=[];
  for(let i=0;i<3000;i++)bars.push({time:i*14400,high:100+i*.01,low:99+i*.01,close:99.5+i*.01,volume:100+i%17});
  const start=process.hrtime.bigint();
  for(const days of [30,60,90,365])I.rollingVwap(bars,days*86400);
  const elapsed=Number(process.hrtime.bigint()-start)/1e6;
  assert.ok(elapsed<50,'elapsed '+elapsed.toFixed(2)+'ms');
});
