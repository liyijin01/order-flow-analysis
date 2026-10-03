(function(global){
  'use strict';

  function finite(v){return Number.isFinite(Number(v));}
  function roundToTick(value,tickSize){
    const tick=Number(tickSize);
    if(!Number.isFinite(tick)||tick<=0)return Number(value);
    return Math.round(Number(value)/tick)*tick;
  }
  function tickPrecision(tickSize){
    const s=String(tickSize);
    if(/[eE]-/.test(s))return Number(s.split(/[eE]-/)[1])||0;
    const i=s.indexOf('.');
    return i<0?0:s.length-i-1;
  }

  function periodKey(time,group){
    const d=new Date(Number(time)*1000);
    if(group==='quarter') return d.getUTCFullYear()+'-Q'+(Math.floor(d.getUTCMonth()/3)+1);
    if(group==='month') return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0');
    if(group==='week'){
      const day=(d.getUTCDay()+6)%7;
      const monday=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-day));
      return monday.toISOString().slice(0,10);
    }
    if(group==='year') return String(d.getUTCFullYear());
    return d.toISOString().slice(0,10);
  }

  function periodBounds(time,group){
    const d=new Date(Number(time)*1000);
    if(group==='quarter'){
      const month=Math.floor(d.getUTCMonth()/3)*3;
      const start=Date.UTC(d.getUTCFullYear(),month,1)/1000;
      return {start,end:Date.UTC(d.getUTCFullYear(),month+3,1)/1000,key:periodKey(time,'quarter')};
    }
    if(group==='month'){
      const start=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)/1000;
      return {start,end:Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)/1000,key:periodKey(time,'month')};
    }
    if(group==='week'){
      const day=(d.getUTCDay()+6)%7;
      const start=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-day)/1000;
      return {start,end:start+7*86400,key:periodKey(time,'week')};
    }
    if(group==='year'){
      const start=Date.UTC(d.getUTCFullYear(),0,1)/1000;
      return {start,end:Date.UTC(d.getUTCFullYear()+1,0,1)/1000,key:String(d.getUTCFullYear())};
    }
    const start=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())/1000;
    return {start,end:start+86400,key:periodKey(time,'day')};
  }

  function valueArea(rows,binSize,pct){
    const sorted=(rows||[]).map(r=>[Number(r[0]),Number(r[1])]).filter(r=>finite(r[0])&&finite(r[1])).sort((a,b)=>a[0]-b[0]);
    if(!sorted.length)return null;
    const total=sorted.reduce((a,r)=>a+r[1],0);
    const size=Number(binSize)||1;
    const midpoint=(sorted[0][0]+sorted[sorted.length-1][0]+size)/2;
    let max=-Infinity,candidates=[];
    sorted.forEach((r,i)=>{if(r[1]>max){max=r[1];candidates=[i];}else if(r[1]===max)candidates.push(i);});
    let pocIndex=candidates[0],best=Infinity;
    for(const i of candidates){
      const dist=Math.abs((sorted[i][0]+size/2)-midpoint);
      if(dist<=best){best=dist;pocIndex=i;}
    }
    let lo=pocIndex,hi=pocIndex,acc=sorted[pocIndex][1];
    const target=total*(pct==null?0.70:pct);
    while(acc<target&&(lo>0||hi<sorted.length-1)){
      const up=(hi+1<sorted.length?sorted[hi+1][1]:0)+(hi+2<sorted.length?sorted[hi+2][1]:0);
      const dn=(lo-1>=0?sorted[lo-1][1]:0)+(lo-2>=0?sorted[lo-2][1]:0);
      if(hi<sorted.length-1&&(lo===0||up>=dn)){
        if(hi+1<sorted.length)acc+=sorted[hi+1][1];
        if(hi+2<sorted.length)acc+=sorted[hi+2][1];
        hi=Math.min(sorted.length-1,hi+2);
      }else{
        if(lo-1>=0)acc+=sorted[lo-1][1];
        if(lo-2>=0)acc+=sorted[lo-2][1];
        lo=Math.max(0,lo-2);
      }
    }
    return {rows:sorted,pocLower:sorted[pocIndex][0],poc:sorted[pocIndex][0]+size/2,vah:sorted[hi][0]+size,val:sorted[lo][0],included:acc,total};
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
      points.push({time:Number(b.time),vwap,upper:vwap+mult*sigma,lower:vwap-mult*sigma,sigma});
    }
    return points;
  }

  function rollingVwap(bars,windowSec){
    const src=(bars||[]).slice().sort((a,b)=>Number(a.time)-Number(b.time)),window=Number(windowSec);
    if(!src.length||!(window>0))return src.map(b=>({time:Number(b.time),value:null}));
    const n=src.length,pv=new Array(n+1).fill(0),vv=new Array(n+1).fill(0),out=new Array(n);
    for(let i=0;i<n;i++){
      const b=src[i],v=Math.max(0,Number(b.volume)||0),tp=(Number(b.high)+Number(b.low)+Number(b.close))/3;
      vv[i+1]=vv[i]+v;pv[i+1]=pv[i]+(Number.isFinite(tp)?tp*v:0);
    }
    let left=0;
    for(let i=0;i<n;i++){
      const t=Number(src[i].time),cut=t-window;
      while(left<=i&&Number(src[left].time)<=cut)left++;
      const full=Number(src[0].time)<=cut;
      const vol=vv[i+1]-vv[left],value=full&&vol>0?(pv[i+1]-pv[left])/vol:null;
      out[i]={time:t,value:Number.isFinite(value)?value:null};
    }
    return out;
  }

  function anchoredPeriodStats(bars,group,intervalSec){
    const all=(bars||[]).slice().sort((a,b)=>a.time-b.time);
    if(!all.length)return[];
    const groups=new Map();
    for(const b of all){
      const bounds=periodBounds(b.time,group);
      let g=groups.get(bounds.key);
      if(!g){g={...bounds,bars:[]};groups.set(bounds.key,g);}
      g.bars.push(b);
    }
    const lastTime=all[all.length-1].time;
    const step=Number(intervalSec)||((all[1]&&all[0])?all[1].time-all[0].time:3600);
    const out=[];
    for(const g of Array.from(groups.values()).sort((a,b)=>a.start-b.start)){
      const points=anchoredVwap(g.bars,g.start,1);
      if(!points.length)continue;
      const final=points[points.length-1];
      const first=g.bars[0],last=g.bars[g.bars.length-1];
      const full=Number(first.time)===Number(g.start);
      const complete=g.end<=lastTime+step;
      out.push({
        key:g.key,start:g.start,end:g.end,full,complete,bars:g.bars,points,
        vwap:final.vwap,upper:final.upper,lower:final.lower,sigma:final.sigma,
        firstTime:first.time,lastTime:last.time
      });
    }
    return out;
  }

  function weeklyVwapStats(bars,intervalSec){
    const step=Number(intervalSec)||1800,src=(bars||[]).slice().sort((a,b)=>Number(a.time)-Number(b.time)),groups=new Map();
    for(const b of src){
      const bounds=periodBounds(b.time,'week');let g=groups.get(bounds.start);
      if(!g){g={start:bounds.start,end:bounds.end,bars:[]};groups.set(bounds.start,g);}
      g.bars.push(b);
    }
    const out=[];
    for(const g of Array.from(groups.values()).sort((a,b)=>a.start-b.start)){
      const points=anchoredVwap(g.bars,g.start,1);if(!points.length)continue;
      const expected=Math.round((g.end-g.start)/step),first=g.bars[0],last=g.bars[g.bars.length-1],missing=Math.max(0,expected-g.bars.length);
      const complete=Number(first.time)===g.start&&Number(last.time)===g.end-step&&missing<=Math.floor(expected*.005);
      out.push({start:g.start,end:g.end,bars:g.bars.length,expectedBars:expected,missing,complete,points,final:points[points.length-1]});
    }
    return out;
  }

  function weeklyProjectionStats(stats){
    const src=(stats||[]).slice().sort((a,b)=>Number(a.start)-Number(b.start)),byStart=new Map(src.map(x=>[Number(x.start),x])),out=[];
    for(const cur of src){
      const prev=byStart.get(Number(cur.start)-7*86400);if(!prev||!prev.complete||!prev.final)continue;
      out.push({weekStart:Number(cur.start),weekEnd:Number(cur.end),pwVwap:Number(prev.final.vwap),pwUpper:Number(prev.final.upper),pwLower:Number(prev.final.lower),sourceStart:Number(prev.start)});
    }
    return out;
  }

  const MONTH_SHORT=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function monthlyBarClosed(bar,asOfMs){
    const close=Number(bar&&bar.closeTime),cut=Number(asOfMs);
    if(Number.isFinite(close)&&Number.isFinite(cut))return close<cut;
    return !!(bar&&bar.complete);
  }
  function monthlyLabel(bar,side){
    const d=new Date(Number(bar.time)*1000);
    return MONTH_SHORT[d.getUTCMonth()]+' '+d.getUTCFullYear()+' '+(side==='high'?'H':'L');
  }
  function monthlyStructureLevels(bars,currentPrice,asOfMs){
    const src=(bars||[]).slice().sort((a,b)=>Number(a.time)-Number(b.time)),current=Number(currentPrice),pivots=[];
    for(let i=1;i<src.length-1;i++){
      const prev=src[i-1],bar=src[i],next=src[i+1];
      if(!monthlyBarClosed(next,asOfMs))continue;
      for(const side of ['high','low']){
        const price=Number(bar[side]),turn=side==='high'
          ? price>Number(prev.high)&&price>Number(next.high)
          : price<Number(prev.low)&&price<Number(next.low);
        if(!turn)continue;
        let broken=false;
        for(let j=i+1;j<src.length;j++){
          const later=src[j];if(!monthlyBarClosed(later,asOfMs))continue;
          const close=Number(later.close);
          if((side==='high'&&close>price)||(side==='low'&&close<price)){broken=true;break;}
        }
        const d=new Date(Number(bar.time)*1000),month=d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0');
        pivots.push({index:i,time:Number(bar.time),month,side,price,broken,label:broken?'S/R':monthlyLabel(bar,side)});
      }
    }
    const nearest=(rows)=>rows.sort((a,b)=>Math.abs(a.price-current)-Math.abs(b.price-current))[0]||null;
    const upper=nearest(pivots.filter(x=>x.price>current&&(x.broken||x.side==='high')));
    const lower=nearest(pivots.filter(x=>x.price<current&&(x.broken||x.side==='low')));
    return{upper,lower,pivots};
  }

  function singlePrintRanges(rows,binSize,minBins){
    const size=Number(binSize)||1,sorted=rows.slice().sort((a,b)=>a[0]-b[0]);
    let start=0,end=sorted.length-1;
    while(start<=end&&sorted[start][1]===1)start+=1;
    while(end>=start&&sorted[end][1]===1)end-=1;
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
    const size=Number(options.binSize),group=options.group||'week',minBins=options.minBins||2,barSec=Number(options.intervalSec)||1800;
    const groups=new Map();
    for(const b of bars||[]){
      const bounds=periodBounds(b.time,group);
      if(!groups.has(bounds.key))groups.set(bounds.key,{key:bounds.key,from:bounds.start,periodEnd:bounds.end,lastBar:b.time,counts:new Map()});
      const g=groups.get(bounds.key);g.lastBar=Math.max(g.lastBar,b.time);
      const lo=Math.floor(Number(b.low)/size),hi=Math.floor((Number(b.high)-Number.EPSILON)/size);
      for(let i=lo;i<=hi;i+=1)g.counts.set(i,(g.counts.get(i)||0)+1);
    }
    const lastTime=bars&&bars.length?bars[bars.length-1].time:0;
    const result=[];
    for(const g of Array.from(groups.values()).sort((a,b)=>a.from-b.from)){
      const rows=Array.from(g.counts.entries()).sort((a,b)=>a[0]-b[0]).map(([i,n])=>[i*size,n]);
      const va=valueArea(rows,size,0.70);
      const complete=g.periodEnd<=lastTime+barSec;
      result.push({
        key:g.key,from:g.from,to:Math.min(g.periodEnd,g.lastBar+barSec),periodEnd:g.periodEnd,complete,binSize:size,rows,
        poc:va&&va.poc,vah:va&&va.vah,val:va&&va.val,singlePrints:singlePrintRanges(rows,size,minBins)
      });
    }
    return result;
  }

  function approxVolumeProfile(bars,binSize){
    const size=Number(binSize),bins=new Map();let sourceVolume=0;
    for(const b of bars||[]){
      const volume=Math.max(0,Number(b.volume)||0);sourceVolume+=volume;
      const lo=Math.floor(Number(b.low)/size),hi=Math.floor((Number(b.high)-Number.EPSILON)/size);
      const count=Math.max(1,hi-lo+1),per=volume/count;
      const buyRatio=volume>0?Math.min(1,Math.max(0,(Number(b.takerBuyBase)||0)/volume)):0.5;
      for(let i=lo;i<=hi;i+=1){
        const row=bins.get(i)||{buy:0,sell:0,total:0};row.total+=per;row.buy+=per*buyRatio;row.sell+=per*(1-buyRatio);bins.set(i,row);
      }
    }
    const rows=Array.from(bins.entries()).sort((a,b)=>a[0]-b[0]).map(([i,v])=>[i*size,v.buy,v.sell,v.total]);
    const distributed=rows.reduce((a,r)=>a+r[3],0);
    if(rows.length&&Math.abs(distributed-sourceVolume)>1e-9)rows[rows.length-1][3]+=sourceVolume-distributed;
    const va=valueArea(rows.map(r=>[r[0],r[3]]),size,0.70);
    return {binSize:size,rows,sourceVolume,distributedVolume:rows.reduce((a,r)=>a+r[3],0),poc:va&&va.poc,vah:va&&va.vah,val:va&&va.val};
  }

  function utcQuarterStart(time){return periodBounds(time,'quarter').start;}
  function previousQuarterStart(time){
    const q=utcQuarterStart(time),d=new Date(q*1000);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-3,1)/1000;
  }
  function utcMonthStart(time){return periodBounds(time,'month').start;}
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
    valueArea,anchoredVwap,rollingVwap,anchoredPeriodStats,weeklyVwapStats,weeklyProjectionStats,monthlyBarClosed,monthlyStructureLevels,tpoProfiles,singlePrintRanges,approxVolumeProfile,
    utcQuarterStart,previousQuarterStart,utcMonthStart,previousMonthStart,periodKey,periodBounds,
    exactProfileToVp,roundToTick,tickPrecision
  };
})(typeof globalThis!=='undefined'?globalThis:window);
