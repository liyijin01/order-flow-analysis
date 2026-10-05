import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

await import(pathToFileURL(path.resolve('web/analysis/engine.js')));
const E=globalThis.OrderFlowAnalysisEngine;
const fx=JSON.parse(fs.readFileSync(path.resolve('web/tests/fixtures/tpo-consistency.json'),'utf8'));

test('D16 E.tpoProfile matches Python shared fixture exactly',()=>{
  const got=E.tpoProfile(fx.bars,fx.rowSize),exp=fx.expected;
  assert.deepEqual(got.rows,exp.rows);
  for(const key of ['poc','vah','val'])assert.equal(got[key],exp[key]);
});
