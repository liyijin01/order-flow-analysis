import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

await import(pathToFileURL(path.resolve('web/analysis/data.js')));
await import(pathToFileURL(path.resolve('web/analysis/engine.js')));
await import(pathToFileURL(path.resolve('web/chart/indicators.js')));
await import(pathToFileURL(path.resolve('web/flow/engine.js')));

const D=globalThis.OrderFlowAnalysisData;
const E=globalThis.OrderFlowAnalysisEngine;
const I=globalThis.OrderFlowIndicators;
const F=globalThis.OrderFlowFlowEngine;

function bar(time,{o=100,h=102,l=98,c=101,v=10,q=1000,bq=550,close=true}={}){
  return{time,openTime:time*1000,closeTime:time*1000+899999,open:o,high:h,low:l,close:c,volume:v,quoteVolume:q,takerBuyBase:v*.55,takerBuyQuote:bq,trades:10,_closed:close};
}

test('D6 CVD uses quote delta, starts at zero and leaves gaps blank',()=>{
  const display=[bar(0),bar(900),bar(1800),bar(2700)];
  const market=[bar(0,{q:100,bq:70}),bar(900,{q:100,bq:40}),bar(2700,{q:200,bq:140})];
  assert.equal(F.cvdDelta(market[0]),40);
  assert.equal(F.cvdDelta(market[1]),-20);
  const cvd=F.cvdSeries(display,market);
  assert.equal(cvd.points[0].value,0);
  assert.equal(cvd.points[1].value,-20);
  assert.equal('value' in cvd.points[2],false);
  assert.equal(cvd.points[3].value,60);
  assert.equal(cvd.missing,1);
  assert.equal(cvd.matched,3);
});

test('D6 spot and perp CVD align only to display timestamps',()=>{
  const display=[0,900,1800,2700].map(t=>bar(t));
  const perp=F.cvdSeries(display,[bar(0),bar(900),bar(1800),bar(2700)]);
  const spot=F.cvdSeries(display,[bar(0),bar(1800),bar(2700)]);
  const allowed=new Set(display.map(x=>x.time));
  assert.equal(perp.points.every(x=>allowed.has(x.time)),true);
  assert.equal(spot.points.every(x=>allowed.has(x.time)),true);
  assert.equal('value' in spot.points[1],false);
});

test('D6 swing anchor chooses earlier dominant extreme and earliest ties',()=>{
  const highFirst=[
    bar(0,{h:120,l:95,o:100}),bar(900,{h:110,l:90,o:105}),bar(1800,{h:108,l:80,o:100})
  ];
  assert.equal(F.swingAnchor(highFirst,14).time,0);

  const lowFirst=[
    bar(0,{h:110,l:80,o:100}),bar(900,{h:120,l:90,o:105}),bar(1800,{h:130,l:95,o:110})
  ];
  assert.equal(F.swingAnchor(lowFirst,14).time,0);

  const tied=[
    bar(0,{h:130,l:90,o:100}),bar(900,{h:130,l:92,o:105}),bar(1800,{h:120,l:80,o:110})
  ];
  const a=F.swingAnchor(tied,14);
  assert.equal(a.highTime,0);
  assert.equal(a.time,0);
});

test('D6 live unfinished bar cannot affect swing anchor',()=>{
  const now=10_000_000;
  const rows=[
    {...bar(0,{h:120,l:90}),closeTime:now-2000},
    {...bar(900,{h:121,l:89}),closeTime:now-1000},
    {...bar(1800,{h:999,l:1}),closeTime:now+900000}
  ];
  const closed=D.closedBars(rows,now);
  assert.deepEqual(closed.map(x=>x.time),[0,900]);
  const anchor=F.swingAnchor(closed,14);
  assert.equal(anchor.time,900);
  assert.notEqual(anchor.time,1800);
});

test('D6 running AVWAP and sigma match independent weighted hlc3 reference',()=>{
  const bars=[
    bar(0,{h:103,l:97,c:101,v:4}),
    bar(900,{h:106,l:100,c:104,v:7}),
    bar(1800,{h:108,l:102,c:103,v:3}),
    bar(2700,{h:110,l:101,c:108,v:9}),
  ];
  const got=I.anchoredVwap(bars,0,1);
  let sv=0,sp=0,sp2=0;
  for(let i=0;i<bars.length;i++){
    const b=bars[i],p=(b.high+b.low+b.close)/3;
    sv+=b.volume;sp+=p*b.volume;sp2+=p*p*b.volume;
    const vwap=sp/sv,sigma=Math.sqrt(Math.max(0,sp2/sv-vwap*vwap));
    const rel=(a,b)=>Math.abs(a-b)/Math.max(1,Math.abs(b));
    assert.ok(rel(got[i].vwap,vwap)<1e-9);
    assert.ok(rel(got[i].sigma,sigma)<1e-9);
    assert.ok(rel(got[i].upper,vwap+sigma)<1e-9);
    assert.ok(rel(got[i].lower,vwap-sigma)<1e-9);
  }
});

test('D6 quarter VWAP is pointwise identical to analysis anchored VWAP',()=>{
  const bars=[];
  for(let i=0;i<16;i++)bars.push(bar(i*3600,{h:100+i,l:96+i,c:98+i,v:5+i}));
  const a=I.anchoredVwap(bars,0,1);
  const b=E.anchoredVwapSeries(bars,0);
  assert.equal(a.length,b.length);
  for(let i=0;i<a.length;i++){
    assert.equal(a[i].time,b[i].time);
    assert.ok(Math.abs(a[i].vwap-b[i].value)/Math.max(1,Math.abs(b[i].value))<1e-12);
  }
});

test('D6 30m alignment introduces no extra logical timestamps',()=>{
  const bars=[];
  for(let i=0;i<12;i++)bars.push(bar(i*900,{h:100+i,l:98+i,c:99+i,v:5+i}));
  const display=F.aggregateBars(bars,'30m');
  const av=I.anchoredVwap(bars,0,1).map(x=>({time:x.time,value:x.vwap}));
  const aligned=E.alignSeriesToBars(av,display,1800);
  const allowed=new Set(display.map(x=>x.time));
  assert.equal(aligned.every(x=>allowed.has(x.time)),true);
  assert.equal(aligned.length,display.length);
});
