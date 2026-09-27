import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

await import(pathToFileURL(path.resolve('web/chart/indicators.js')));
await import(pathToFileURL(path.resolve('web/chart/annotate.js')));
const I=globalThis.OrderFlowIndicators;
const A=globalThis.OrderFlowAnnotate;

const config={
  levels:{visiblePadPct:15,mergeTolerancePct:.1,maxLabels:8},
  touch:{lookbackBars:60,toleranceTicks:0},
  cross:{enabled:true,confirmBars:2,lookbackBars:60},
  singlePrints:{minBins:2},
  zones:{scopes:['PY_M'],nearestN:2},
};

test('B1/B7 events never use bars before a level becomes effective',()=>{
  const level={scope:'PQ',label:'PQ VAL',price:100,from:100,source:'exact'};
  const bars=[
    {time:10,low:95,high:99,close:99},
    {time:20,low:99,high:101,close:101},
    {time:30,low:100,high:103,close:102},
    {time:40,low:101,high:104,close:103},
    {time:100,low:95,high:99,close:99},
    {time:110,low:99,high:101,close:101},
    {time:120,low:100,high:103,close:102},
    {time:130,low:101,high:104,close:103},
  ];
  assert.equal(A.findTouch(level,bars,60,0).time,120);
  const cross=A.findCross(level,bars,2,60);
  assert.equal(cross.bar.time,110);
  assert.ok(cross.bar.time>=level.from);
});

test('B7 cross lookback bounds old crossings',()=>{
  const level={price:100,from:1};
  const bars=[];
  bars.push({time:1,close:99,low:98,high:100});
  bars.push({time:2,close:101,low:99,high:102});
  bars.push({time:3,close:102,low:101,high:103});
  bars.push({time:4,close:103,low:102,high:104});
  for(let i=5;i<80;i++)bars.push({time:i,close:103,low:102,high:104});
  assert.equal(A.findCross(level,bars,2,20),null);
});

test('B2/B10 current TPO uses dPOC and never creates untraded current-period lines',()=>{
  const profiles=[];
  for(let i=0;i<8;i++){
    profiles.push({
      key:'w'+i,from:i*100,periodEnd:(i+1)*100,to:(i+1)*100,complete:i<7,
      binSize:1,rows:[[99,2],[100,3],[101,2]],poc:100.5,vah:102,val:99,singlePrints:[]
    });
  }
  const bars=[];
  for(let t=0;t<850;t+=10)bars.push({time:t,low:90,high:95,close:93});
  const doc=A.buildPreset({
    preset:'p3',symbol:'BTCUSDT',market:'um',interval:'30m',bars,tpoBars:bars,tpoProfiles:profiles,
    context:{currentPrice:93,visibleMin:80,visibleMax:110,tickSize:.1,visibleStartTime:0,visibleEndTime:850},
    config,
  });
  const profileItems=doc.items.filter(x=>x.type==='profile');
  assert.equal(profileItems.length,8);
  assert.equal(profileItems.at(-1).pocLabel,'dPOC ▸');
  const currentLines=doc.items.filter(x=>x.type==='level'&&x.from===800);
  assert.equal(currentLines.length,0);
});

test('B10 untraded references extend right or stop at first post-period touch',()=>{
  const profile={key:'w0',from:0,periodEnd:100,to:100,complete:true,binSize:1,rows:[[99,2],[100,3],[101,2]],poc:100,vah:105,val:95,singlePrints:[]};
  const bars=[
    {time:100,low:90,high:94,close:92},
    {time:110,low:99,high:101,close:100},
    {time:120,low:91,high:94,close:93},
  ];
  const doc=A.buildPreset({
    preset:'p3',symbol:'BTCUSDT',market:'um',interval:'30m',bars,tpoBars:bars,tpoProfiles:[profile],
    context:{currentPrice:93,visibleMin:80,visibleMax:110,tickSize:1,visibleStartTime:0,visibleEndTime:120},
    config,
  });
  const poc=doc.items.find(x=>x.type==='level'&&x.label==='nPOC W');
  const vah=doc.items.find(x=>x.type==='level'&&x.label==='nVAH W');
  assert.equal(poc.to,110);
  assert.equal(vah.to,null);
});

test('B9 P4 chooses the two nearest previous-year month bands',()=>{
  const bars=[{time:Date.UTC(2026,8,1)/1000,close:100}];
  const months=[
    {key:'2025-01',start:1,end:2,complete:true,full:true,vwap:50,upper:60,lower:40},
    {key:'2025-02',start:3,end:4,complete:true,full:true,vwap:96,upper:102,lower:90},
    {key:'2025-03',start:5,end:6,complete:true,full:true,vwap:105,upper:110,lower:100},
  ];
  const doc=A.buildPreset({
    preset:'p4',symbol:'BTCUSDT',market:'um',interval:'2h',bars,monthStats:months,
    context:{currentPrice:100,visibleMin:30,visibleMax:120,tickSize:1,visibleStartTime:1,visibleEndTime:bars[0].time},
    config,
  });
  const zones=doc.items.filter(x=>x.type==='zone');
  assert.equal(zones.length,2);
  assert.deepEqual(zones.map(x=>x.label).sort(),['py feb','py mar']);
});

test('B10 eight weeks of constructed 30m data produce eight TPO profiles',()=>{
  const bars=[],start=Date.UTC(2026,6,27)/1000;
  for(let i=0;i<8*7*48;i++){
    const time=start+i*1800,week=Math.floor(i/(7*48)),base=100+week*3;
    bars.push({time,low:base,high:base+2,close:base+1,volume:10,takerBuyBase:5});
  }
  const profiles=I.tpoProfiles(bars,{binSize:1,group:'week',minBins:2,intervalSec:1800});
  assert.equal(profiles.length,8);
  assert.equal(profiles.slice(0,-1).every(p=>p.complete),true);
});

test('B5 levels beyond maxLabels remain valid lines with hidden labels',()=>{
  const levels=[];
  for(let i=0;i<10;i++)levels.push({scope:'PQ',label:'L'+i,price:100+i*0.05,from:1,source:'exact'});
  const items=A.buildLevelAnnotations(levels,[],{currentPrice:100,visibleMin:99,visibleMax:102,tickSize:.01,maxLabels:3},{...config,levels:{...config.levels,maxLabels:3},cross:{enabled:false},touch:{lookbackBars:60,toleranceTicks:0}});
  const lines=items.filter(x=>x.type==='level');
  assert.equal(lines.length,10);
  assert.equal(lines.filter(x=>x.showLabel!==false).length,3);
  assert.equal(lines.filter(x=>x.showLabel===false).length,7);
  assert.equal(lines.every(x=>typeof x.label==='string'&&x.label.length>0),true);
});
