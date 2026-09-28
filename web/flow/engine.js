(function(global){
  'use strict';

  function finite(v){return Number.isFinite(Number(v));}
  function utcWeekStart(time){
    const d=new Date(Number(time)*1000),day=(d.getUTCDay()+6)%7;
    return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-day)/1000;
  }
  function aggregateBars(bars,timeframe){
    if(timeframe==='15m')return (bars||[]).slice();
    const step=timeframe==='30m'?1800:900;
    const groups=new Map();
    for(const b of bars||[]){
      const key=Math.floor(Number(b.time)/step)*step;
      let g=groups.get(key);
      if(!g){
        g={time:key,openTime:key*1000,closeTime:0,open:Number(b.open),high:Number(b.high),low:Number(b.low),close:Number(b.close),volume:0,quoteVolume:0,takerBuyBase:0,takerBuyQuote:0,trades:0,count:0};
        groups.set(key,g);
      }
      g.high=Math.max(g.high,Number(b.high));g.low=Math.min(g.low,Number(b.low));g.close=Number(b.close);
      g.closeTime=Math.max(Number(g.closeTime)||0,Number(b.closeTime)||0);
      g.volume+=Number(b.volume)||0;g.quoteVolume+=Number(b.quoteVolume)||0;
      g.takerBuyBase+=Number(b.takerBuyBase)||0;g.takerBuyQuote+=Number(b.takerBuyQuote)||0;
      g.trades+=Number(b.trades)||0;g.count++;
    }
    const expected=timeframe==='30m'?2:1;
    return Array.from(groups.values()).filter(g=>g.count===expected).sort((a,b)=>a.time-b.time);
  }

  function swingAnchor(closed15m,lookbackDays){
    const bars=(closed15m||[]).slice().sort((a,b)=>Number(a.time)-Number(b.time));
    if(!bars.length)return null;
    const last=bars[bars.length-1],cut=Number(last.time)-Math.max(1,Number(lookbackDays)||14)*86400;
    const window=bars.filter(b=>Number(b.time)>=cut);
    if(!window.length)return null;
    let hi=-Infinity,lo=Infinity,hiBar=null,loBar=null;
    for(const b of window){
      const h=Number(b.high),l=Number(b.low),t=Number(b.time);
      if(h>hi){hi=h;hiBar=b;}
      else if(h===hi&&hiBar&&t<Number(hiBar.time))hiBar=b;
      if(l<lo){lo=l;loBar=b;}
      else if(l===lo&&loBar&&t<Number(loBar.time))loBar=b;
    }
    const chosen=Number(hiBar.time)<=Number(loBar.time)?hiBar:loBar;
    return{mode:'swing',time:Number(chosen.time),price:Number(chosen.open),highTime:Number(hiBar.time),lowTime:Number(loBar.time)};
  }

  function manualAnchor(bars,iso){
    const ms=Date.parse(String(iso||''));if(!Number.isFinite(ms))throw new Error('manual AVWAP anchor is invalid');
    const t=Math.floor(ms/1000);
    if(t%900!==0)throw new Error('manual AVWAP anchor must align to a 15m bar');
    const bar=(bars||[]).find(b=>Number(b.time)===t);
    if(!bar)throw new Error('manual AVWAP anchor is outside loaded 15m data');
    return{mode:'manual',time:t,price:Number(bar.open)};
  }

  function cvdDelta(bar){return 2*Number(bar&&bar.takerBuyQuote||0)-Number(bar&&bar.quoteVolume||0);}
  function cvdSeries(displayBars,marketBars){
    const map=new Map((marketBars||[]).map(b=>[Number(b.time),b])),out=[];let value=0,started=false,missing=0,matched=0;
    for(const b of displayBars||[]){
      const row=map.get(Number(b.time));
      if(!row){out.push({time:Number(b.time)});missing++;continue;}
      if(!started){started=true;value=0;}
      else value+=cvdDelta(row);
      out.push({time:Number(b.time),value,live:!!row.live});matched++;
    }
    return{points:out,value,missing,matched};
  }

  function cumulativeAt(side,boundary){
    if(Number(boundary)===0)return 0;
    const key=String(Number(boundary));
    const v=side&&side[key];return finite(v)?Number(v):null;
  }
  function depthBuckets(snapshot,buckets){
    const out=[];
    for(const pair of buckets||[]){
      const a=Number(pair[0]),b=Number(pair[1]);
      const bidB=cumulativeAt(snapshot&&snapshot.bid,b),bidA=cumulativeAt(snapshot&&snapshot.bid,a);
      const askB=cumulativeAt(snapshot&&snapshot.ask,b),askA=cumulativeAt(snapshot&&snapshot.ask,a);
      if([bidB,bidA,askB,askA].some(v=>v==null)){out.push(null);continue;}
      const bid=bidB-bidA,ask=askB-askA;
      out.push({a,b,bid,ask,delta:bid-ask});
    }
    return out;
  }

  function asOfDepth(displayBars,snapshots,intervalSec,buckets){
    const src=(snapshots||[]).slice().sort((a,b)=>Number(a.time)-Number(b.time)),out=[];let j=0,last=null,empty=0,used=0;
    const tol=Math.max(1,Number(intervalSec)||900);
    for(const bar of displayBars||[]){
      const close=Number(bar.time)+tol;
      while(j<src.length&&Number(src[j].time)<=close){last=src[j];j++;}
      if(!last||close-Number(last.time)>tol){out.push({time:Number(bar.time),buckets:null});empty++;continue;}
      const vals=depthBuckets(last,buckets);
      if(vals.some(v=>v==null)){out.push({time:Number(bar.time),buckets:null});empty++;continue;}
      out.push({time:Number(bar.time),buckets:vals,snapshotTime:Number(last.time)});used++;
    }
    return{rows:out,emptyBars:empty,snapshotsUsed:used};
  }

  function formatSigned(value){
    const n=Number(value);if(!Number.isFinite(n))return'—';
    const a=Math.abs(n),sign=n>0?'+':(n<0?'−':'');
    if(a>=1e9)return sign+(a/1e9).toFixed(a>=1e10?1:2)+'B';
    if(a>=1e6)return sign+(a/1e6).toFixed(a>=1e7?1:2)+'M';
    if(a>=1e3)return sign+(a/1e3).toFixed(a>=1e4?1:2)+'K';
    return sign+a.toFixed(0);
  }

  function positionText(price,point){
    if(!point)return'—';const p=Number(price);
    if(p>Number(point.s2u))return'above +2σ';
    if(p>Number(point.s1u))return'above +1σ';
    if(p<Number(point.s2l))return'below -2σ';
    if(p<Number(point.s1l))return'below -1σ';
    return'inside ±1σ';
  }

  global.OrderFlowFlowEngine={utcWeekStart,aggregateBars,swingAnchor,manualAnchor,cvdDelta,cvdSeries,depthBuckets,asOfDepth,formatSigned,positionText};
})(typeof globalThis!=='undefined'?globalThis:window);
