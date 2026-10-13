'use strict';
const fs=require('fs'),path=require('path');
const PRICE_TEMPLATES=['quarter','rvwap','weekly','monthly','mprofile','wprofile'];
const SYMBOLS=['BTCUSDT','ETHUSDT','SOLUSDT'];
function zonesFor(levels,currentPrice){
  const price=Number(currentPrice);
  if(!Number.isFinite(price)||price<=0)throw new Error('invalid current price');
  const filtered=(levels||[]).filter(x=>Number.isFinite(Number(x.price))&&
    Math.abs(Number(x.price)-price)<=price*.15&&PRICE_TEMPLATES.includes(x.template))
    .map(x=>({...x,price:Number(x.price)})).sort((a,b)=>a.price-b.price);
  const clusters=[];
  for(const level of filtered){
    const current=clusters[clusters.length-1];
    if(current&&level.price-current.high<=price*.005+1e-9){
      current.high=level.price;current.levels.push(level);
    }else{
      clusters.push({low:level.price,high:level.price,levels:[level]});
    }
  }
  return clusters.map(cluster=>{
    const templates=[...new Set(cluster.levels.map(x=>x.template))];
    const sources=templates.length;
    return{...cluster,sources,strength:sources>=3?'strong':sources===2?'medium':'single'};
  });
}
function briefFor(symbol,data,manifest,generatedAt,dataCutoffUtc){
  const values=PRICE_TEMPLATES.map(t=>data[symbol]&&data[symbol][t]);
  if(values.some(v=>!v))throw new Error('Missing brief template: '+symbol);
  const price=Number(values.find(v=>Number.isFinite(Number(v.currentPrice)))?.currentPrice);
  if(!Number.isFinite(price)||price<=0)throw new Error('Invalid brief price: '+symbol);
  const levels=values.flatMap(v=>v.levels||[]);
  const ssd=data.SSD&&data.SSD.ssd;
  if(!ssd||!Array.isArray(ssd.states)||!ssd.states.length)throw new Error('Missing SSD states');
  const states=values.flatMap(v=>v.states||[]).concat(ssd.states);
  if(!levels.length||!states.length)throw new Error('Empty brief levels/states: '+symbol);
  const pngs=manifest.filter(x=>x.symbol===symbol&&PRICE_TEMPLATES.includes(x.template)).map(x=>x.file);
  const ssdPng=manifest.find(x=>x.template==='ssd'&&x.symbol==='SSD');
  if(!ssdPng)throw new Error('Missing SSD PNG');
  pngs.push(ssdPng.file);
  if(pngs.length!==7||new Set(pngs).size!==7)throw new Error('Expected seven unique PNGs for '+symbol);
  return{generatedAt,dataCutoffUtc,symbol,currentPrice:price,
    zones:zonesFor(levels,price),levels,states,pngs};
}
function writeBriefFiles(options){
  const {outputRoot,raw,manifest,generatedAt,dataCutoffUtc}=options;
  const dir=path.join(outputRoot,'analysis','brief');fs.mkdirSync(dir,{recursive:true});
  const results={};
  for(const symbol of SYMBOLS){
    const payload=briefFor(symbol,raw,manifest,generatedAt,dataCutoffUtc);
    fs.writeFileSync(path.join(dir,symbol+'.json'),JSON.stringify(payload,null,2));
    results[symbol]=payload;
  }
  return results;
}
module.exports={zonesFor,briefFor,writeBriefFiles,PRICE_TEMPLATES,SYMBOLS};
