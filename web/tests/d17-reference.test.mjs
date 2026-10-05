import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

await import(pathToFileURL(path.resolve('web/analysis/engine.js')));
const E=globalThis.OrderFlowAnalysisEngine;
const iso=(n)=>new Date(Date.UTC(2026,0,5)+n*7*86400_000).toISOString();

test('D17 reference week excludes latest four and chooses widest containing range',()=>{
  const rows=Array.from({length:10},(_,i)=>({start:iso(i),complete:true,low:90-i,high:110+i}));
  rows[4].low=60;rows[4].high=140;
  rows[8].low=50;rows[8].high=150;
  const got=E.selectReferenceWeek(rows,100,null);
  assert.equal(got.start,iso(4));
  assert.equal(got.manual,false);
});

test('D17 manual reference week overrides automatic selection',()=>{
  const rows=Array.from({length:8},(_,i)=>({start:iso(i),complete:true,low:80,high:120}));
  const target=iso(2).slice(0,10),got=E.selectReferenceWeek(rows,100,target);
  assert.equal(got.start,iso(2));assert.equal(got.manual,true);
});

test('D17 reference week requires containing current price',()=>{
  const rows=Array.from({length:8},(_,i)=>({start:iso(i),complete:true,low:10,high:20}));
  assert.equal(E.selectReferenceWeek(rows,100,null),null);
});
