import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

await import(pathToFileURL(path.resolve('web/analysis/engine.js')));
const E=globalThis.OrderFlowAnalysisEngine;

test('D18 profile price window uses configured percentages',()=>{
  assert.deepEqual(E.profilePriceWindow(100,{below:18,above:25},null),{min:82,max:125});
  assert.deepEqual(E.profilePriceWindow(100,{below:10,above:12},null),{min:90,max:112});
});

test('D18 profile price window expands to include forming profile extremes',()=>{
  assert.deepEqual(E.profilePriceWindow(100,{below:18,above:25},{low:70,high:140}),{min:70,max:140});
  assert.deepEqual(E.profilePriceWindow(100,{below:10,above:12},{low:95,high:130}),{min:90,max:130});
});
