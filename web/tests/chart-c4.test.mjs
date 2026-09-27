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

test('C4 approx marker is carried into label and output is stable',()=>{
  const input={
    preset:'p1',symbol:'BTCUSDT',market:'um',interval:'1h',
    bars:[{time:1,open:99,high:101,low:98,close:100},{time:2,open:100,high:102,low:99,close:101},{time:3,open:101,high:103,low:100,close:102},{time:4,open:102,high:104,low:101,close:103}],
    context:{currentPrice:103,visibleMin:90,visibleMax:110,tickSize:1},config:cfg,
    vwap:[{time:2,vwap:100,upper:102,lower:98}],previousQuarterVp:{vah:105,poc:100,val:95},previousQuarterFrom:1
  };
  const a=A.buildPreset(input),b=A.buildPreset(input);
  assert.deepEqual(a,b);
  assert.ok(a.items.some(x=>x.source==='approx'));
  assert.ok(a.items.filter(x=>x.type==='level').some(x=>x.label.includes('≈')));
  const ids=a.items.map(x=>x.id);assert.deepEqual(ids,ids.slice().sort());
});
