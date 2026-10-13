import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const {zonesFor,briefFor}=require('../../scripts/d21_build_brief.cjs');
const sandbox={};vm.runInNewContext(fs.readFileSync(new URL('../analysis/brief.js',import.meta.url),'utf8'),sandbox);
const B=sandbox.OrderFlowBrief;
const l=(price,template)=>({price,template,name:'line',kind:'line'});
test('adjacent 0.5% levels cluster transitively',()=>{
 const z=zonesFor([l(100,'quarter'),l(100.49,'rvwap'),l(100.98,'weekly')],100);
 assert.equal(z.length,1);assert.equal(z[0].sources,3);assert.equal(z[0].strength,'strong');
});
test('distinct template sources',()=>{
 const z=zonesFor([l(100,'quarter'),l(100.1,'quarter'),l(100.2,'weekly')],100);
 assert.equal(z[0].sources,2);assert.equal(z[0].strength,'medium');
});
test('15% exclusion and single retention',()=>{
 const z=zonesFor([l(84.99,'quarter'),l(85,'quarter'),l(100,'weekly'),l(115,'rvwap'),l(115.01,'monthly')],100);
 assert.equal(z.flatMap(x=>x.levels).length,3);
 assert.equal(zonesFor([l(101,'mprofile')],100)[0].strength,'single');
});
test('state line and range boundaries',()=>{
 assert.equal(B.lineState('n',101,100,'quarter').state,'above');
 assert.equal(B.lineState('n',99,100,'quarter').state,'below');
 assert.equal(B.lineState('n',100,100,'quarter').state,'inside');
 assert.equal(B.rangeState('n',99,100,110,'quarter').state,'below');
 assert.equal(B.rangeState('n',111,100,110,'quarter').state,'above');
 assert.equal(B.rangeState('n',100,100,110,'quarter').state,'inside');
 assert.equal(B.rangeState('n',110,100,110,'quarter').state,'inside');
 assert.equal(B.rangeState('n',105,100,110,'quarter').distancePct,0);
});
test('seven PNGs and SSD state',()=>{
 const raw={BTCUSDT:{},SSD:{ssd:{states:[{name:'ssd',value:9,reference:9.064,state:'below',distancePct:0.1,template:'ssd'}]}}};
 const ts=['quarter','rvwap','weekly','monthly','mprofile','wprofile'];
 for(const t of ts)raw.BTCUSDT[t]={currentPrice:100,levels:[l(101,t)],states:[{name:t,value:100,reference:99,state:'above',distancePct:1,template:t}]};
 const files=ts.map(t=>({symbol:'BTCUSDT',template:t,file:'BTCUSDT-'+t+'.png'}));
 files.push({symbol:'SSD',template:'ssd',file:'SSD-1d.png'});
 const data=briefFor('BTCUSDT',raw,files,'2026-10-13T00:00:00Z','2026-10-12T23:59:59Z');
 assert.equal(data.pngs.length,7);assert.equal(data.states.length,7);assert.equal(data.zones[0].strength,'strong');
});

test('past-year VAH/VAL is included in RVWAP brief states',()=>{
 const scope={OrderFlowBrief:B,OrderFlowTemplates:{}};
 vm.runInNewContext(fs.readFileSync(new URL('../analysis/templates/rvwap.js',import.meta.url),'utf8'),scope);
 const ts=Date.UTC(2026,9,12)/1000;
 const model={last:{time:ts},current:100,
   rvwap:{rolling:{'365':[{time:ts,value:98}]},yearSegments:[{start:Date.UTC(2026,0,1)/1000,end:Date.UTC(2027,0,1)/1000,points:[{time:ts,vwap:97}]}]},
   yearLevels:[{price:110,label:'2024 VAH'},{price:99,label:'2025 VAL'},{price:100.01,label:'2024 VWAP'}]};
 const states=scope.OrderFlowTemplates.rvwap.briefStates({model});
 assert.equal(states.length,3);
 assert.ok(states.some(s=>s.name==='现价 vs 2025 VAL'));
});
test('daily brief linked and published by Pages workflow',()=>{
 const index=fs.readFileSync(new URL('../../index.html',import.meta.url),'utf8');
 const flow=fs.readFileSync(new URL('../../.github/workflows/pages.yml',import.meta.url),'utf8');
 assert.ok(index.includes('href="brief.html"'));
 assert.ok(flow.includes('cp index.html chart.html analysis.html flow.html brief.html _site/'));
 assert.ok(flow.includes('cp -R web/chart web/analysis web/brief web/flow'));
});
