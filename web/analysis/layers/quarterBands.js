(function(global){
  'use strict';

  const registry=global.OrderFlowLayers=global.OrderFlowLayers||{};

  registry.quarterBands={
    needs(){
      return{'1h':5000};
    },

    build(ctx){
      const {state,E,I,D,bundle,display}=ctx;
      const oneHour=bundle.series['1h']||[];
      if(!oneHour.length||!display.length)return{quarterVwaps:[],currentVwap:[]};
      const starts=[];
      let quarter=E.utcQuarterStart(display[0].time);
      const end=E.utcQuarterStart(display[display.length-1].time);
      while(quarter<=end){
        starts.push(quarter);
        const date=new Date(quarter*1000);
        quarter=Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+3,1)/1000;
      }
      const intervalSec=D.intervalSec(state.timeframe);
      const quarterVwaps=[];
      for(const start of starts){
        const date=new Date(start*1000);
        const next=Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+3,1)/1000;
        const calc=oneHour.filter(bar=>Number(bar.time)>=start&&Number(bar.time)<next);
        if(!calc.length)continue;
        const raw=I.anchoredVwap(calc,start,1);
        if(!raw.length)continue;
        const target=display.filter(bar=>Number(bar.time)>=start&&Number(bar.time)<next);
        const maps={};
        for(const key of ['vwap','upper','lower']){
          maps[key]=new Map(
            E.alignSeriesToBars(raw.map(point=>({time:point.time,value:point[key]})),target,intervalSec)
              .map(point=>[point.time,point.value])
          );
        }
        const points=[];
        for(const bar of target){
          const time=Number(bar.time);
          if(maps.vwap.has(time)&&maps.upper.has(time)&&maps.lower.has(time)){
            points.push({
              time,
              vwap:maps.vwap.get(time),
              upper:maps.upper.get(time),
              lower:maps.lower.get(time)
            });
          }
        }
        if(points.length)quarterVwaps.push({start,end:next,points,final:points[points.length-1]});
      }
      const last=display[display.length-1];
      const currentStart=E.utcQuarterStart(last.time);
      const current=(quarterVwaps.find(item=>item.start===currentStart)||quarterVwaps[quarterVwaps.length-1]||{points:[]}).points;
      return{
        quarterVwaps,
        currentVwap:current.map(point=>({time:point.time,value:point.vwap}))
      };
    }
  };
})(typeof globalThis!=='undefined'?globalThis:window);
