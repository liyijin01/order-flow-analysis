(function(global){
  'use strict';
  // Read-only projections of values already calculated for each chart template.
  const valid=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
  const number=x=>Number(x);
  function line(out,price,name,template,kind='line'){
    if(valid(price)&&number(price)>0&&name)out.push({price:number(price),name:String(name),template,kind});
    return out;
  }
  function lines(model,template){
    const out=[];
    for(const item of model&&model.levels||[]){
      const name=item.label||(item.current?'当前 POC':item.month&&item.side?item.month+' '+item.side.toUpperCase():item.week&&item.side?item.week+' '+item.side.toUpperCase():item.kind==='weekly-pw'?'上周 VWAP':null);
      line(out,item.price,name,template);
    }
    return out;
  }
  function regions(model,template){
    const out=[];
    for(const r of model&&model.regions||[]){
      const name=r.label||(
        r.scope==='SINGLE_PRINT'?'single print':
        r.scope==='WEEKLY_PROJECTION'?'上周价值区':
        r.scope==='MONTHLY_IMBALANCE'?'imbalance':'价值区'
      );
      line(out,r.bottom,name+' 下沿',template,'edge');
      line(out,r.top,name+' 上沿',template,'edge');
    }
    return out;
  }
  function last(points,key='value'){
    if(!Array.isArray(points))return null;
    for(let i=points.length-1;i>=0;i--)if(valid(points[i]&&points[i][key]))return number(points[i][key]);
    return null;
  }
  function lineState(name,current,reference,template){
    if(!valid(current)||!valid(reference))return null;
    const p=number(current),r=number(reference),state=p>r?'above':p<r?'below':'inside';
    return{name,value:p,reference:r,state,distancePct:p===0?null:Math.abs(p-r)/Math.abs(p)*100,template};
  }
  function rangeState(name,current,low,high,template){
    if(!valid(current)||!valid(low)||!valid(high))return null;
    const p=number(current),lo=Math.min(number(low),number(high)),hi=Math.max(number(low),number(high));
    const state=p>hi?'above':p<lo?'below':'inside';
    const distance=state==='above'?p-hi:state==='below'?lo-p:0;
    return{name,value:p,reference:{low:lo,high:hi},state,distancePct:p===0?null:distance/Math.abs(p)*100,template};
  }
  const present=values=>values.filter(Boolean);
  global.OrderFlowBrief={valid,line,lines,regions,last,lineState,rangeState,present};
})(typeof globalThis!=='undefined'?globalThis:window);
