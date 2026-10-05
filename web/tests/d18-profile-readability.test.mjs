import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

await import(pathToFileURL(path.resolve('web/analysis/engine.js')));
const E=globalThis.OrderFlowAnalysisEngine;

test('D18 profile price window uses configured percentages',()=>{
  const monthly=E.profilePriceWindow(100,{below:18,above:25},null);
  const weekly=E.profilePriceWindow(100,{below:10,above:12},null);
  assert.ok(Math.abs(monthly.min-82)<1e-9&&Math.abs(monthly.max-125)<1e-9);
  assert.ok(Math.abs(weekly.min-90)<1e-9&&Math.abs(weekly.max-112)<1e-9);
});

test('D18 profile price window expands to include forming profile extremes',()=>{
  assert.deepEqual(E.profilePriceWindow(100,{below:18,above:25},{low:70,high:140}),{min:70,max:140});
  assert.deepEqual(E.profilePriceWindow(100,{below:10,above:12},{low:95,high:130}),{min:90,max:130});
});


test('D18 touched profile extensions keep newest eight by touch time',()=>{
  const items=Array.from({length:10},(_,i)=>({
    from:i,side:'poc',price:100+i,naked:false,touchedBy:{start:new Date(Date.UTC(2026,0,i+1)).toISOString()}
  }));
  const selected=E.selectRecentTouched(items,8);
  assert.equal(selected.length,8);
  assert.deepEqual(selected.map(x=>x.from),[9,8,7,6,5,4,3,2]);
});


test('D18 marks only naked levels touched by the forming period',()=>{
  const forming={low:95,high:105};
  assert.equal(E.profileTouchedThisPeriod({naked:true,price:100},forming),true);
  assert.equal(E.profileTouchedThisPeriod({naked:true,price:110},forming),false);
  assert.equal(E.profileTouchedThisPeriod({naked:false,price:100},forming),false);
});
