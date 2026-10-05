import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

globalThis.OrderFlowAnalysisEngine={axisLabelSelection:()=>[],regionLabelLayout:()=>[]};
await import(pathToFileURL(new URL('../analysis/primitive.js',import.meta.url).pathname));
const {mergeProfileRows}=globalThis.OrderFlowAnalysisPrimitive;

test('D16 profile rows merge to at least two display pixels',()=>{
  const rows=[[100,1],[110,2],[120,3],[130,4],[140,5]];
  const got=mergeProfileRows(rows,10,.7,2);
  assert.deepEqual(got.map(x=>[x.bottom,x.top,x.count,x.rows]),[[100,130,6,3],[130,150,9,2]]);
});

test('D16 profile rows stay definition-sized when already at least two pixels',()=>{
  const rows=[[100,1],[110,2],[120,3]],got=mergeProfileRows(rows,10,3,2);
  assert.deepEqual(got.map(x=>[x.bottom,x.top,x.count]),[[100,110,1],[110,120,2],[120,130,3]]);
});
