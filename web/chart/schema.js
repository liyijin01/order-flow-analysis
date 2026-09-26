(function(global){
'use strict';
const TYPES=new Set(['level','zone','profile','band','marker','callout','range','vline','text']);
const SOURCES=new Set(['exact','approx','manual']);
function num(v){return typeof v==='number'&&Number.isFinite(v)}
function str(v){return typeof v==='string'&&v.length>0}
function time(v){return Number.isInteger(v)&&v>0}
function validateItem(x){
  const e=[];
  if(!x||typeof x!=='object') return {ok:false,errors:['item must be object']};
  if(!str(x.id))e.push('id required');
  if(!TYPES.has(x.type))e.push('unsupported type');
  if(x.source!=null&&!SOURCES.has(x.source))e.push('invalid source');
  if(x.from!=null&&!time(x.from))e.push('from must be UTC seconds');
  if(x.to!=null&&!time(x.to))e.push('to must be UTC seconds or null');
  switch(x.type){
    case 'level': if(!num(x.price))e.push('price required'); break;
    case 'zone': if(!num(x.top)||!num(x.bottom)||x.top<x.bottom)e.push('top/bottom invalid'); break;
    case 'profile':
      if(!['tpo','vp'].includes(x.kind))e.push('kind invalid');
      if(!Array.isArray(x.rows)||!x.rows.every(r=>Array.isArray(r)&&r.length>=2&&num(r[0])&&num(r[1])))e.push('rows invalid');
      break;
    case 'band':
      if(!Array.isArray(x.points)||!x.points.every(p=>Array.isArray(p)&&p.length>=4&&time(p[0])&&p.slice(1,4).every(num)))e.push('points invalid');
      break;
    case 'marker': if(!time(x.time)||!num(x.price))e.push('time/price required'); break;
    case 'callout': if(!time(x.time)||!num(x.price)||!str(x.text))e.push('time/price/text required'); break;
    case 'range': if(!time(x.from)||!num(x.high)||!num(x.low)||x.high<x.low)e.push('range invalid'); break;
    case 'vline': if(!time(x.time))e.push('time required'); break;
    case 'text': if(!time(x.time)||!num(x.price)||!str(x.text))e.push('time/price/text required'); break;
  }
  return {ok:e.length===0,errors:e};
}
function validateDocument(doc){
  const errors=[];const items=[];
  if(!doc||doc.schema!=='annotations-v1')errors.push('schema must be annotations-v1');
  if(!doc||!str(doc.symbol))errors.push('symbol required');
  if(!doc||!['um','spot'].includes(doc.market))errors.push('market invalid');
  if(!doc||!str(doc.interval))errors.push('interval required');
  const source=doc&&Array.isArray(doc.items)?doc.items:[];
  source.forEach((item,i)=>{const r=validateItem(item);if(r.ok)items.push(item);else console.warn('[annotations-v1] skip item '+i+(item&&item.id?' '+item.id:'')+': '+r.errors.join('; '));});
  return {ok:errors.length===0,errors,items};
}
global.OrderFlowAnnotationSchema={validateItem,validateDocument,TYPES:[...TYPES]};
})(typeof globalThis!=='undefined'?globalThis:window);
