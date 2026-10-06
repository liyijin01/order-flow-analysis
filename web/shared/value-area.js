(function(global){
  'use strict';

  function finite(value){
    return Number.isFinite(Number(value));
  }

  function valueArea(rows,binSize,pct){
    const sorted=(rows||[])
      .map(row=>[Number(row[0]),Number(row[1])])
      .filter(row=>finite(row[0])&&finite(row[1]))
      .sort((a,b)=>a[0]-b[0]);
    if(!sorted.length)return null;
    const total=sorted.reduce((sum,row)=>sum+row[1],0);
    const size=Number(binSize)||1;
    let max=-Infinity;
    let pocIndex=0;
    const midpoint=(sorted[0][0]+sorted[sorted.length-1][0]+size)/2;
    let best=Infinity;
    for(let i=0;i<sorted.length;i++){
      const value=sorted[i][1];
      const distance=Math.abs((sorted[i][0]+size/2)-midpoint);
      if(value>max||(value===max&&distance<=best)){
        max=value;
        pocIndex=i;
        best=distance;
      }
    }
    let lo=pocIndex;
    let hi=pocIndex;
    let included=sorted[pocIndex][1];
    const target=total*(pct==null?.70:Number(pct));
    while(included<target&&(lo>0||hi<sorted.length-1)){
      const up=hi<sorted.length-1?sorted[hi+1][1]:-1;
      const down=lo>0?sorted[lo-1][1]:-1;
      if(up>=down&&hi<sorted.length-1){
        hi++;
        included+=sorted[hi][1];
      }else if(lo>0){
        lo--;
        included+=sorted[lo][1];
      }else{
        hi++;
        included+=sorted[hi][1];
      }
    }
    return{
      poc:sorted[pocIndex][0]+size/2,
      vah:sorted[hi][0]+size,
      val:sorted[lo][0],
      included,
      total
    };
  }

  function tpoProfile(bars,binSize){
    const size=Number(binSize)||1;
    const bins=new Map();
    for(const bar of bars||[]){
      const lo=Math.floor(Number(bar.low)/size);
      const hi=Math.floor((Number(bar.high)-1e-12)/size);
      for(let index=lo;index<=hi;index++){
        bins.set(index,(bins.get(index)||0)+1);
      }
    }
    const rows=Array.from(bins.entries())
      .sort((a,b)=>a[0]-b[0])
      .map(([index,count])=>[index*size,count]);
    const area=valueArea(rows,size,.70);
    return{binSize:size,rows,...(area||{})};
  }

  global.OrderFlowValueArea={valueArea,tpoProfile};
})(typeof globalThis!=='undefined'?globalThis:window);
