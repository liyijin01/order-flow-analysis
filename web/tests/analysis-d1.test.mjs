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

test('D1 nPOC is removed once later candle touches the price',()=>{
  assert.equal(E.isPocNaked(100,10,[{time:9,low:99,high:101},{time:11,low:101,high:102}]),true);
  assert.equal(E.isPocNaked(100,10,[{time:11,low:99,high:101}]),false);
});
