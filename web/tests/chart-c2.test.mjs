import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

await import(pathToFileURL(path.resolve('web/chart/schema.js')));
await import(pathToFileURL(path.resolve('web/chart/render/primitives/base.js')));
for (const name of ['level','zone','profile','band','marker','callout','range','vline','text']) {
  await import(pathToFileURL(path.resolve('web/chart/render/primitives/'+name+'.js')));
}

const S=globalThis.OrderFlowAnnotationSchema;
const registry=globalThis.OrderFlowAnnotationPrimitives;

test('all §6 annotation types have a primitive registered',()=>{
  assert.deepEqual(Object.keys(registry).sort(),S.TYPES.slice().sort());
  for(const type of S.TYPES) assert.equal(typeof registry[type],'function');
});

test('invalid item is skipped while valid item survives document validation',()=>{
  const doc={
    schema:'annotations-v1',symbol:'BTCUSDT',market:'um',interval:'1h',generatedAt:'2026-09-26T07:00:00Z',
    items:[
      {id:'ok',type:'level',price:82000,label:'PW POC',from:1788998400,to:null,axisLabel:true,source:'exact'},
      {id:'bad',type:'range',from:1788998400,to:1789171200,high:79000,low:81000}
    ]
  };
  const result=S.validateDocument(doc);
  assert.equal(result.valid,true);
  assert.equal(result.items.length,1);
  assert.equal(result.items[0].id,'ok');
  assert.equal(result.itemErrors.length,1);
  assert.equal(result.itemErrors[0].id,'bad');
});

test('approx source is accepted and invalid source rejected',()=>{
  assert.equal(S.validateItem({id:'a',type:'level',price:1,label:'x',from:1788998400,to:null,source:'approx'}).valid,true);
  assert.equal(S.validateItem({id:'b',type:'level',price:1,label:'x',from:1788998400,to:null,source:'guess'}).valid,false);
});

for(const id of ['p1','p2','p3','p4','p5']){
  test(id+' fixture validates with zero skipped items',()=>{
    const doc=JSON.parse(fs.readFileSync(path.resolve('web/chart/fixtures/'+id+'.json'),'utf8'));
    const result=S.validateDocument(doc);
    assert.equal(result.valid,true);
    assert.equal(result.itemErrors.length,0);
    assert.equal(result.items.length,doc.items.length);
  });
}
