import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

await import(pathToFileURL(path.resolve('web/analysis/engine.js')));
const E=globalThis.OrderFlowAnalysisEngine;

function baseBars(){
  const bars=[];
  for(let i=0;i<24;i++)bars.push({time:i,open:100,high:105,low:95,close:101,volume:10,takerBuyBase:5});
  bars.push({time:24,open:100,high:102,low:98,close:101,volume:10,takerBuyBase:5});
  bars.push({time:25,open:101,high:103,low:99,close:100,volume:10,takerBuyBase:5});
  bars.push({time:26,open:100,high:102,low:98,close:100,volume:10,takerBuyBase:5});
  return bars;
}
const cfg={impulseMaxBars:3,impulseMinMoveAtr:1.5,impulseMinBodyPct:.5,requireDeltaAlign:true,baseMaxBars:5,baseMaxRangeAtr:1,maxAgeBars:300,perSide:2,maxDistancePct:20};

test('D1 demand zone: consolidation plus upward impulse with aligned delta',()=>{
  const bars=baseBars();
  bars.push({time:27,open:100,high:121,low:99,close:119,volume:10,takerBuyBase:9});
  bars.push({time:28,open:119,high:123,low:118,close:121,volume:10,takerBuyBase:6});
  const zones=E.detectZones(bars,cfg);
  assert.ok(zones.some(z=>z.type==='demand'&&z.bottom<=98&&z.top>=103));
});

test('D1 supply zone: consolidation plus downward impulse with aligned delta',()=>{
  const bars=baseBars();
  bars.push({time:27,open:100,high:101,low:79,close:81,volume:10,takerBuyBase:1});
  bars.push({time:28,open:81,high:82,low:77,close:79,volume:10,takerBuyBase:4});
  const zones=E.detectZones(bars,cfg);
  assert.ok(zones.some(z=>z.type==='supply'));
});

test('D1 zone rejects opposite delta direction',()=>{
  const bars=baseBars();
  bars.push({time:27,open:100,high:121,low:99,close:119,volume:10,takerBuyBase:1});
  assert.equal(E.detectZones(bars,cfg).filter(z=>z.created===27).length,0);
});

test('D1 demand becomes tested then invalid after far-boundary close',()=>{
  const tested=baseBars();
  tested.push({time:27,open:100,high:121,low:99,close:119,volume:10,takerBuyBase:9});
  tested.push({time:28,open:119,high:120,low:101,close:110,volume:10,takerBuyBase:5});
  const zones=E.detectZones(tested,cfg);
  assert.ok(zones.some(z=>z.type==='demand'&&z.tested));

  const invalid=baseBars();
  invalid.push({time:27,open:100,high:121,low:99,close:119,volume:10,takerBuyBase:9});
  invalid.push({time:28,open:119,high:120,low:90,close:90,volume:10,takerBuyBase:5});
  assert.equal(E.detectZones(invalid,cfg).filter(z=>z.type==='demand').length,0);
});

test('D1 overlapping zones merge by union and preserve untested state',()=>{
  const merged=E.mergeZones([
    {type:'demand',bottom:90,top:100,from:1,created:2,strength:2.1,tested:true,ageBars:4},
    {type:'demand',bottom:95,top:105,from:3,created:4,strength:1.7,tested:false,ageBars:2},
  ]);
  assert.equal(merged.length,1);assert.equal(merged[0].bottom,90);assert.equal(merged[0].top,105);
  assert.equal(merged[0].strength,2.1);assert.equal(merged[0].tested,false);
});

test('D1 selects at most two supply and two demand zones',()=>{
  const zones=[];
  for(let i=0;i<5;i++)zones.push({type:'supply',bottom:110+i*5,top:112+i*5,strength:2,tested:false,ageBars:1,from:i,created:i});
  for(let i=0;i<5;i++)zones.push({type:'demand',bottom:88-i*5,top:90-i*5,strength:2,tested:false,ageBars:1,from:i,created:i});
  const selected=E.selectZones(zones,100,cfg);
  assert.ok(selected.filter(x=>x.type==='supply').length<=2);
  assert.ok(selected.filter(x=>x.type==='demand').length<=2);
});

test('D1 value areas suppress >70% overlap in favor of longer period',()=>{
  const areas=[
    {scope:'PW',bottom:90,top:110},{scope:'PQ',bottom:91,top:109},{scope:'PM',bottom:130,top:140}
  ];
  const out=E.filterValueAreas(areas,80,150,10,70);
  assert.ok(out.some(x=>x.scope==='PQ'));assert.ok(!out.some(x=>x.scope==='PW'));assert.ok(out.length<=3);
});

test('D1 price-axis collision hides lower priority instead of moving price',()=>{
  const coords=p=>p;
  const out=E.axisLabelSelection([
    {id:'zone',price:100,priority:3},{id:'value',price:105,priority:2},{id:'line',price:110,priority:1},{id:'far',price:130,priority:1}
  ],coords,14);
  assert.equal(out.find(x=>x.id==='zone').visible,true);
  assert.equal(out.find(x=>x.id==='value').visible,false);
  assert.equal(out.find(x=>x.id==='line').visible,false);
  assert.equal(out.find(x=>x.id==='far').visible,true);
  assert.equal(out.find(x=>x.id==='zone').y,100);
});

test('D5 price-axis labels reserve space for the latest-price label',()=>{
  const out=E.axisLabelSelection([
    {id:'near-above',price:90,priority:3},
    {id:'near-below',price:115,priority:2},
    {id:'clear',price:120,priority:1}
  ],p=>p,18,[100]);
  assert.equal(out.find(x=>x.id==='near-above').visible,false);
  assert.equal(out.find(x=>x.id==='near-below').visible,false);
  assert.equal(out.find(x=>x.id==='clear').visible,true);
  assert.equal(out.find(x=>x.id==='clear').y,120);
});

test('D1 nPOC is removed once later candle touches the price',()=>{
  assert.equal(E.isPocNaked(100,10,[{time:9,low:99,high:101},{time:11,low:101,high:102}]),true);
  assert.equal(E.isPocNaked(100,10,[{time:11,low:99,high:101}]),false);
});


test('D10 key levels exclude PQ, merge under one tick, filter to view and cap at six',()=>{
  const pq=Date.UTC(2026,3,1)/1000,iso=s=>new Date(s*1000).toISOString();
  const items=[
    {id:'a',label:'Q1 VAH',kind:'quarter',price:100,periodStart:iso(Date.UTC(2026,0,1)/1000),definition:'Q'},
    {id:'b',label:'PY Q4 VAH',kind:'py-quarter',price:100.005,periodStart:iso(Date.UTC(2025,9,1)/1000),definition:'Q'},
    {id:'pq',label:'Q2 VAL',kind:'quarter',price:99,periodStart:iso(pq),definition:'Q'},
    {id:'m1',label:'PY Nov VAL',kind:'py-month',price:101,periodStart:iso(Date.UTC(2025,10,1)/1000),definition:'M'},
    {id:'m2',label:'PY Oct VAL',kind:'py-month',price:102,periodStart:iso(Date.UTC(2025,9,1)/1000),definition:'M'},
    {id:'m3',label:'PY Sep VAL',kind:'py-month',price:103,periodStart:iso(Date.UTC(2025,8,1)/1000),definition:'M'},
    {id:'q3',label:'PY Q3 VAL',kind:'py-quarter',price:104,periodStart:iso(Date.UTC(2025,6,1)/1000),definition:'Q'},
    {id:'q2',label:'PY Q2 VAL',kind:'py-quarter',price:105,periodStart:iso(Date.UTC(2025,3,1)/1000),definition:'Q'},
    {id:'far',label:'PY Jan VAL',kind:'py-month',price:140,periodStart:iso(Date.UTC(2025,0,1)/1000),definition:'M'}
  ];
  const got=E.selectKeyLevels(items,100,90,110,10,.01,6,pq,2,2,[]);
  assert.ok(got.selected.length<=6);
  assert.equal(got.selected.some(x=>x.label.includes('Q2 VAL')&&!x.label.includes('PY')),false);
  assert.ok(got.all.some(x=>x.label.includes('Q1 VAH')&&x.label.includes('PY Q4 VAH')&&x.label.includes(' · ')));
  assert.equal(got.selected.every(x=>E.inPriceView(x.price,90,110,10)),true);
});

test('D11 key levels prefer quarters, cap monthly lines and enforce price-span gap',()=>{
  const iso=(y,m,d)=>new Date(Date.UTC(y,m-1,d)).toISOString(),items=[];
  for(let i=0;i<12;i++)items.push({
    id:'q'+i,label:'PY Q'+i+' VAH',kind:'py-quarter',price:80+i*3,
    periodStart:iso(2025,1+(i%4)*3,1),definition:'Q'
  });
  for(let i=0;i<24;i++)items.push({
    id:'m'+i,label:'PY M'+i+' VAL',kind:'py-month',price:81+i,
    periodStart:iso(2025,1+(i%12),1),definition:'M'
  });
  const got=E.selectKeyLevels(items,100,70,130,0,.01,6,Date.UTC(2026,3,1)/1000,2,2,[88,112]);
  assert.ok(got.selected.length<=6);
  assert.ok(got.selected.filter(x=>x.keyKind==='py-month').length<=2);
  const gap=(130-70)*.02;
  for(let i=0;i<got.selected.length;i++)for(let j=i+1;j<got.selected.length;j++){
    assert.ok(Math.abs(got.selected[i].price-got.selected[j].price)>=gap);
  }
  for(const row of got.selected)assert.ok(Math.abs(row.price-88)>=gap&&Math.abs(row.price-112)>=gap);
  assert.ok(got.selected.filter(x=>x.keyKind!=='py-month').length>=4);
});



test('D12b combined table is capped at 16 rows with a summary row',()=>{
  const rows=Array.from({length:20},(_,i)=>({type:'row '+i,high:200-i}));
  const got=E.capTableRows(rows,16);
  assert.equal(got.length,16);
  assert.equal(got[15].summary,true);
  assert.equal(got[15].type,'另有 5 条');
});


test('D12b key-level spacing enforces pixel gap and reserves PQ VWAP',()=>{
  const iso=(y,m,d)=>new Date(Date.UTC(y,m-1,d)).toISOString();
  const items=[
    {id:'near',label:'Q1 VAH',kind:'quarter',price:101,periodStart:iso(2026,1,1),definition:'Q'},
    {id:'clear',label:'PY Q4 VAL',kind:'py-quarter',price:106,periodStart:iso(2025,10,1),definition:'Q'}
  ];
  const got=E.selectKeyLevels(items,100,90,110,10,.01,6,Date.UTC(2026,3,1)/1000,2,2,[100],18,100);
  assert.equal(got.selected.some(x=>x.id==='near'),false);
  assert.equal(got.selected.some(x=>x.id==='clear'),true);
});
