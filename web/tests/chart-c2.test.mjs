import test from 'node:test';
import assert from 'node:assert/strict';

await import('../chart/schema.js');
const S=globalThis.OrderFlowAnnotationSchema;

test('annotations-v1 validates all C2 item types',()=>{
  const base={id:'x',source:'exact'};
  const items=[
    {...base,type:'level',price:1},
    {...base,type:'zone',top:2,bottom:1},
    {...base,type:'profile',kind:'tpo',rows:[[1,2]]},
    {...base,type:'band',points:[[1700000000,1,2,0]]},
    {...base,type:'marker',time:1700000000,price:1},
    {...base,type:'callout',time:1700000000,price:1,text:'x'},
    {...base,type:'range',from:1700000000,high:2,low:1},
    {...base,type:'vline',time:1700000000},
    {...base,type:'text',time:1700000000,price:1,text:'x'},
  ];
  for(const item of items) assert.equal(S.validateItem(item).ok,true,item.type);
});

test('invalid items are skipped while valid document remains usable',()=>{
  const doc={schema:'annotations-v1',symbol:'BTCUSDT',market:'um',interval:'1h',items:[
    {id:'good',type:'level',price:100,source:'exact'},
    {id:'bad',type:'zone',top:1,bottom:2,source:'exact'},
  ]};
  const old=console.warn;console.warn=()=>{};
  try{
    const r=S.validateDocument(doc);
    assert.equal(r.ok,true);
    assert.equal(r.items.length,1);
    assert.equal(r.items[0].id,'good');
  }finally{console.warn=old;}
});

test('approx source is accepted and unsupported source is rejected',()=>{
  assert.equal(S.validateItem({id:'a',type:'level',price:1,source:'approx'}).ok,true);
  assert.equal(S.validateItem({id:'b',type:'level',price:1,source:'guess'}).ok,false);
});
