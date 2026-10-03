import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

await import(pathToFileURL(path.resolve('web/chart/indicators.js')));
const I=globalThis.OrderFlowIndicators;
const fixture=JSON.parse(fs.readFileSync(path.resolve('web/tests/fixtures/btcusdt-um-1M-2026-10-01.json'),'utf8'));
const bars=fixture.bars,asOf=Date.parse(fixture.asOfUtc),current=Number(bars.at(-1).close);
const rel=(a,b)=>Math.abs(Number(a)-Number(b))/Math.abs(Number(b));

test('D15 monthly S/R gold selects Jan high and broken May high',()=>{
  const got=I.monthlyStructureLevels(bars,current,asOf);
  assert.ok(got.upper);assert.ok(got.lower);
  assert.equal(got.upper.month,'2026-01');assert.equal(got.upper.label,'Jan 2026 H');assert.equal(got.upper.side,'high');assert.equal(got.upper.broken,false);
  assert.equal(got.lower.month,'2026-05');assert.equal(got.lower.label,'S/R');assert.equal(got.lower.side,'high');assert.equal(got.lower.broken,true);
  assert.ok(rel(got.upper.price,97924.49)<=0.003,'upper '+got.upper.price);
  assert.ok(rel(got.lower.price,82850)<=0.003,'lower '+got.lower.price);
});

test('D15 forming month cannot confirm a turning point or break S/R',()=>{
  const tiny=[
    {time:1,high:10,low:5,close:7,closeTime:1000,complete:true},
    {time:2,high:20,low:6,close:18,closeTime:2000,complete:true},
    {time:3,high:9,low:4,close:30,closeTime:9000,complete:false},
  ];
  const got=I.monthlyStructureLevels(tiny,15,3000);
  assert.equal(got.pivots.length,0);
});
