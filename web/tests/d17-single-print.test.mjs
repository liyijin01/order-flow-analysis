import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

await import(pathToFileURL(path.resolve('web/analysis/engine.js')));
const E=globalThis.OrderFlowAnalysisEngine;
const iso=n=>new Date(Date.UTC(2026,0,5)+n*7*86400_000).toISOString();

test('D17 single print trimming removes touched portion and keeps untouched remainder',()=>{
  const periods=[{start:iso(0),complete:true,low:70,high:130,singlePrints:[[80,100]]},{start:iso(1),complete:true,low:90,high:95,singlePrints:[]}];
  const got=E.remainingSinglePrints(periods,100,1,6);
  assert.deepEqual(got.map(x=>[x.bottom,x.top]),[[95,100],[80,90]]);
});

test('D17 single print min height uses current-price threshold',()=>{
  const periods=[{start:iso(0),complete:true,low:1,high:200,singlePrints:[[90,93],[100,104]]}];
  assert.equal(E.remainingSinglePrints(periods,2000,1,6).length,2);
  assert.equal(E.remainingSinglePrints(periods,4000,1,6).length,0);
});

test('D17 single prints are capped at six',()=>{
  const periods=Array.from({length:8},(_,i)=>({start:iso(i),complete:true,low:1,high:2,singlePrints:[[50+i*5,54+i*5]]}));
  assert.equal(E.remainingSinglePrints(periods,88,1,6).length,6);
});
