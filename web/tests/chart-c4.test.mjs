import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
await import(pathToFileURL(path.resolve('web/chart/annotate.js')));
const A=globalThis.OrderFlowAnnotate;

const cfg={levels:{visiblePadPct:10,mergeTolerancePct:.1,maxLabels:3},touch:{lookbackBars:60,toleranceTicks:0},cross:{enabled:true,confirmBars:2}};

test('C4 filtering uses visible pad and nearest/longer-period priority',()=>{
  const levels=[
    {label:'PW',scope:'PW',price:100,from:1},{label:'PY',scope:'PY',price:100,from:1},
    {label:'far',scope:'PY',price:130,from:1},{label:'near',scope:'PM',price:101,from:1},
  ];
  const out=A.filterLevels(levels,{currentPrice:100,visibleMin:90,visibleMax:110},cfg.levels);
  assert.equal(out.length,3);assert.equal(out[0].label,'PY');assert.ok(!out.some(x=>x.label==='far'));
});

test('C4 merge combines close levels and preserves longer period',()=>{
  const out=A.mergeLevels([
    {label:'PW POC',scope:'PW',price:100,source:'exact'},
    {label:'PQ VAL',scope:'PQ',price:100.05,source:'exact'},
  ],.1);
  assert.equal(out.length,1);assert.equal(out[0].scope,'PQ');assert.match(out[0].label,/PQ VAL/);assert.match(out[0].label,/PW POC/);
});

test('C4 naked POC cutoff stops at first later touch',()=>{
  const bars=[{time:10,low:90,high:95},{time:20,low:99,high:101},{time:30,low:98,high:102}];
  assert.equal(A.cutoffNakedPoc({price:100,from:10},bars,0),20);
  assert.equal(A.cutoffNakedPoc({price:110,from:10},bars,0),null);
});

test('C4 touch returns most recent touch and cross confirms bars',()=>{
  const level={price:100,label:'L'};
  const bars=[
    {time:1,low:95,high:99,close:99},{time:2,low:99,high:101,close:101},
    {time:3,low:100,high:103,close:102},{time:4,low:101,high:104,close:103},
  ];
  assert.equal(A.findTouch(level,bars,60,0).time,3);
  const c=A.findCross(level,bars,2);assert.equal(c.direction,'above');assert.equal(c.bar.time,2);
});

test('C4 P1 uses completed-period final VWAP levels and stable output',()=>{
  const bars=[
    {time:100,open:99,high:101,low:98,close:100,volume:10},
    {time:200,open:100,high:103,low:99,close:102,volume:12},
    {time:300,open:102,high:104,low:101,close:103,volume:11}
  ];
  const complete={key:'2026-Q2',start:10,end:90,complete:true,full:true,vwap:100,upper:105,lower:95,points:[{time:10,vwap:99,upper:104,lower:94}]};
  const current={key:'2026-Q3',start:90,end:999,complete:false,full:true,vwap:102,upper:107,lower:97,points:[{time:100,vwap:101,upper:106,lower:96},{time:300,vwap:102,upper:107,lower:97}]};
  const input={preset:'p1',symbol:'BTCUSDT',market:'um',interval:'1h',bars,intervalSec:3600,
    context:{currentPrice:103,visibleMin:90,visibleMax:110,tickSize:1,visibleStartTime:100,visibleEndTime:300},config:cfg,
    quarterStats:[complete,current],monthStats:[]};
  const a=A.buildPreset(input),b=A.buildPreset(input);
  assert.deepEqual(a,b);
  assert.ok(a.items.some(x=>x.type==='band'));
  assert.ok(a.items.some(x=>x.type==='level'&&x.label.includes('PQ VWAP')&&x.from===90));
  assert.ok(!a.items.some(x=>String(x.label).includes('Q VWAP start')));
  const ids=a.items.map(x=>x.id);assert.deepEqual(ids,ids.slice().sort());
});
