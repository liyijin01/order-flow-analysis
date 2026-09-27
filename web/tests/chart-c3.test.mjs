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
  assert.deepEqual(p.rows,[[100,1],[101,2],[102,1]]);
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
