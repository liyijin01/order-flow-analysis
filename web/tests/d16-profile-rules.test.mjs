import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

await import(pathToFileURL(new URL('../analysis/engine.js',import.meta.url).pathname));
const E=globalThis.OrderFlowAnalysisEngine;

const p=(month,vah,val,poc,high,low)=>({start:month+'-01T00:00:00Z',end:'2099-01-01T00:00:00Z',complete:true,vah,val,poc,high,low});

test('D16 profile extension stops at first later completed touch',()=>{
  const rows=[p('2026-01',110,90,100,120,80),p('2026-02',130,115,120,135,112),p('2026-03',140,125,130,145,121)];
  const got=E.profileExtensions(rows,['vah']).find(x=>x.period.start.startsWith('2026-01'));
  assert.equal(got.naked,false);
  assert.equal(got.touchedBy.start,'2026-02-01T00:00:00Z');
  assert.equal(got.to,Date.parse('2026-02-01T00:00:00Z')/1000);
});

test('D16 value-area box picks the latest completed containing current price',()=>{
  const rows=[p('2025-11',105,80,90,110,75),p('2026-01',120,95,100,125,90),p('2026-02',130,110,120,135,105)];
  assert.equal(E.selectProfileValueBox(rows,100).start,'2026-01-01T00:00:00Z');
});
