(function(global){
  'use strict';

  function finite(v){return Number.isFinite(Number(v));}
  function periodKey(time,group){
    const d=new Date(Number(time)*1000);
    if(group==='month') return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0');
    if(group==='week'){
      const day=(d.getUTCDay()+6)%7;
      const monday=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-day));
      return monday.toISOString().slice(0,10);
    }
    return d.toISOString().slice(0,10);
  }

  function valueArea(rows,binSize,pct){
    const sorted=(rows||[]).map(r=>[Number(r[0]),Number(r[1])]).filter(r=>finite(r[0])&&finite(r[1])).sort((a,b)=>a[0]-b[0]);
    if(!sorted.length) return null;
    const total=sorted.reduce((a,r)=>a+r[1],0);
    const size=Number(binSize)||1;
    const midpoint=(sorted[0][0]+sorted[sorted.length-1][0]+size)/2;
    let max=-Infinity,candidates=[];
    sorted.forEach((r,i)=>{if(r[1]>max){max=r[1];candidates=[i];}else if(r[1]===max)candidates.push(i);});
    let pocIndex=candidates[0],best=Infinity;
    for(const i of candidates){
      const dist=Math.abs((sorted[i][0]+size/2)-midpoint);
      if(dist<best){best=dist;pocIndex=i;}
    }
    let lo=pocIndex,hi=pocIndex,acc=sorted[pocIndex][1];
    const target=total*(pct==null?0.70:pct);
    while(acc<target && (lo>0||hi<sorted.length-1)){
      const up=(hi+1<sorted.length?sorted[hi+1][1]:0)+(hi+2<sorted.length?sorted[hi+2][1]:0);
      const dn=(lo-1>=0?sorted[lo-1][1]:0)+(lo-2>=0?sorted[lo-2][1]:0);
      if(hi<sorted.length-1 && (lo===0||up>=dn)){
        if(hi+1<sorted.length)acc+=sorted[hi+1][1];
        if(hi+2<sorted.length)acc+=sorted[hi+2][1];
        hi=Math.min(sorted.length-1,hi+2);
      }else{
        if(lo-1>=0)acc+=sorted[lo-1][1];
        if(lo-2>=0)acc+=sorted[lo-2][1];
        lo=Math.max(0,lo-2);
      }
    }
    return {
      rows:sorted,pocLower:sorted[pocIndex][0],poc:sorted[pocIndex][0]+size/2,
      vah:sorted[hi][0]+size,val:sorted[lo][0],included:acc,total
    };
  }

  function anchoredVwap(bars,anchorTime,k){
    const mult=k==null?1:Number(k);
    let sumV=0,sumPV=0,sumP2V=0;
    const points=[];
    for(const b of bars||[]){
      if(Number(b.time)<Number(anchorTime))continue;
      const v=Number(b.volume)||0,tp=(Number(b.high)+Number(b.low)+Number(b.close))/3;
      if(!(v>0)||!finite(tp))continue;
      sumV+=v;sumPV+=tp*v;sumP2V+=tp*tp*v;
      const vwap=sumPV/sumV;
      const variance=Math.max(0,sumP2V/sumV-vwap*vwap);
      const sigma=Math.sqrt(variance);
      points.push({time:b.time,vwap,upper:vwap+mult*sigma,lower:vwap-mult*sigma,sigma});
    }
    return points;
  }

  function singlePrintRanges(rows,binSize,minBins){
    const size=Number(binSize)||1, sorted=rows.slice().sort((a,b)=>a[0]-b[0]);
    let start=0,end=sorted.length-1;
    while(start<=end && sorted[start][1]===1)start+=1;
    while(end>=start && sorted[end][1]===1)end-=1;
    const out=[];let run=null;
    for(let i=start;i<=end;i+=1){
      if(sorted[i][1]===1){
        if(!run)run={bottom:sorted[i][0],top:sorted[i][0]+size,count:1};
        else{run.top=sorted[i][0]+size;run.count+=1;}
      }else if(run){
        if(run.count>=(minBins||1))out.push(run);run=null;
      }
    }
    if(run&&run.count>=(minBins||1))out.push(run);
    return out;
  }

  function tpoProfiles(bars,options){
    const size=Number(options.binSize),group=options.group||'week',minBins=options.minBins||2;
    const groups=new Map();
    for(const b of bars||[]){
      const key=periodKey(b.time,group);
      if(!groups.has(key))groups.set(key,{key,from:b.time,to:b.time,counts:new Map()});
      const g=groups.get(key);g.from=Math.min(g.from,b.time);g.to=Math.max(g.to,b.time);
      const lo=Math.floor(Number(b.low)/size),hi=Math.floor((Number(b.high)-Number.EPSILON)/size);
      for(let i=lo;i<=hi;i+=1)g.counts.set(i,(g.counts.get(i)||0)+1);
    }
    const result=[];
    for(const g of Array.from(groups.values()).sort((a,b)=>a.from-b.from)){
      const rows=Array.from(g.counts.entries()).sort((a,b)=>a[0]-b[0]).map(([i,n])=>[i*size,n]);
      const va=valueArea(rows,size,0.70);
      result.push({
        key:g.key,from:g.from,to:g.to+1800,binSize:size,rows,
        poc:va&&va.poc,vah:va&&va.vah,val:va&&va.val,
        singlePrints:singlePrintRanges(rows,size,minBins)
      });
    }
    return result;
  }

  function approxVolumeProfile(bars,binSize){
    const size=Number(binSize),bins=new Map();
    let sourceVolume=0;
    for(const b of bars||[]){
      const volume=Math.max(0,Number(b.volume)||0);sourceVolume+=volume;
      const lo=Math.floor(Number(b.low)/size),hi=Math.floor((Number(b.high)-Number.EPSILON)/size);
      const count=Math.max(1,hi-lo+1),per=volume/count;
      const buyRatio=volume>0?Math.min(1,Math.max(0,(Number(b.takerBuyBase)||0)/volume)):0.5;
      for(let i=lo;i<=hi;i+=1){
        const row=bins.get(i)||{buy:0,sell:0,total:0};
        row.total+=per;row.buy+=per*buyRatio;row.sell+=per*(1-buyRatio);bins.set(i,row);
      }
    }
    const rows=Array.from(bins.entries()).sort((a,b)=>a[0]-b[0]).map(([i,v])=>[i*size,v.buy,v.sell,v.total]);
    const distributed=rows.reduce((a,r)=>a+r[3],0);
    if(rows.length && Math.abs(distributed-sourceVolume)>1e-9)rows[rows.length-1][3]+=sourceVolume-distributed;
    const va=valueArea(rows.map(r=>[r[0],r[3]]),size,0.70);
    return {binSize:size,rows,sourceVolume,distributedVolume:rows.reduce((a,r)=>a+r[3],0),poc:va&&va.poc,vah:va&&va.vah,val:va&&va.val};
  }

  function utcQuarterStart(time){
    const d=new Date(Number(time)*1000),m=Math.floor(d.getUTCMonth()/3)*3;
    return Date.UTC(d.getUTCFullYear(),m,1)/1000;
  }
  function previousQuarterStart(time){
    const q=utcQuarterStart(time),d=new Date(q*1000);
    return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-3,1)/1000;
  }
  function utcMonthStart(time){
    const d=new Date(Number(time)*1000);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)/1000;
  }
  function previousMonthStart(time){
    const d=new Date(Number(time)*1000);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-1,1)/1000;
  }

  function exactProfileToVp(payload,periodName){
    if(!payload||!payload.profiles||!payload.profiles[periodName])return null;
    const p=payload.profiles[periodName],size=Number(payload.binSize);
    const rows=(p.rows||[]).map(r=>[Number(r[0])*size,Number(r[1]||0),Number(r[2]||0),Number(r[1]||0)+Number(r[2]||0)]);
    const va=valueArea(rows.map(r=>[r[0],r[3]]),size,0.70);
    return {source:'exact',binSize:size,rows,poc:va&&va.poc,vah:va&&va.vah,val:va&&va.val,complete:!!p.complete,days:p.days||[]};
  }

  global.OrderFlowIndicators={
    valueArea,anchoredVwap,tpoProfiles,singlePrintRanges,approxVolumeProfile,
    utcQuarterStart,previousQuarterStart,utcMonthStart,previousMonthStart,periodKey,exactProfileToVp
  };
})(typeof globalThis!=='undefined'?globalThis:window);
