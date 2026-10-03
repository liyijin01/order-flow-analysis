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


test('D15 monthly imbalance gold selects Aug-Oct bullish gap',()=>{
  const gaps=I.monthlyImbalances(bars,asOf);
  const recent=bars.slice(-12);let viewMin=Infinity,viewMax=-Infinity;for(const x of recent){if(Number(x.low)<viewMin)viewMin=Number(x.low);if(Number(x.high)>viewMax)viewMax=Number(x.high);}
  const got=I.selectMonthlyImbalance(gaps,current,viewMin,viewMax,10);
  assert.ok(got);
  assert.equal(got.type,'bullish');
  assert.equal(got.c1Month,'2026-08');
  assert.equal(got.c3Month,'2026-10');
  assert.equal(got.forming,true);
  assert.equal(got.formingEdge,'top');
  assert.ok(rel(got.low,81478.87)<=0.003,'imbalance low '+got.low);
  assert.ok(rel(got.high,83410.39)<=0.005,'imbalance high '+got.high);
});

test('D15 bullish imbalance shrinks and disappears when fully filled',()=>{
  const t=i=>Date.UTC(2026,i,1)/1000,ct=i=>Date.UTC(2026,i+1,1)-1,cut=Date.UTC(2026,5,15);
  const base=[
    {time:t(0),high:100,low:80,close:90,closeTime:ct(0)},
    {time:t(1),high:120,low:90,close:110,closeTime:ct(1)},
    {time:t(2),high:150,low:130,close:140,closeTime:ct(2)},
    {time:t(3),high:145,low:115,close:120,closeTime:ct(3)}
  ];
  let gaps=I.monthlyImbalances(base,cut);
  assert.equal(gaps.length,1);assert.equal(gaps[0].low,100);assert.equal(gaps[0].high,115);
  const filled=base.concat([{time:t(4),high:120,low:95,close:100,closeTime:Date.UTC(2026,6,1)-1}]);
  gaps=I.monthlyImbalances(filled,Date.UTC(2026,6,15));
  assert.equal(gaps.length,0);
});
