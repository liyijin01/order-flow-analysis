(function(global){
  'use strict';
  const registry=global.OrderFlowTemplates=global.OrderFlowTemplates||{};
  const E=global.OrderFlowAnalysisEngine;
  function infoLine(ctx,bar,add){
    const {model,line2,fmtPrice}=ctx;
    const segments=model.quarterVwaps||[];
    const current=segments.find(x=>x.start===E.utcQuarterStart(model.last.time))||segments[segments.length-1];
    const c=current&&current.final||{};
    const previousStart=E.previousQuarterStart(model.last.time);
    const previous=segments.find(x=>x.start===previousStart);
    const p=previous&&previous.final||model.pqStats||{};
    line2.textContent='Anchored VWAP (hlc3, Quarter, ±1σ)';
    add('  '+fmtPrice(c.vwap),'vwap');
    add('  +1σ '+fmtPrice(c.upper),'sigma');
    add('  −1σ '+fmtPrice(c.lower),'sigma');
    add('  PQ '+fmtPrice(p.vwap),'pqvwap');
    add('  +1σ '+fmtPrice(p.upper),'sigma');
    add('  −1σ '+fmtPrice(p.lower),'sigma');
    model.infoValues={current:c,previous:{vwap:p.vwap,upper:p.upper,lower:p.lower},barTime:Number(bar.time)};
  }

  const definition={
    modelBuilder:true,
    needs(){return{};},
    build(ctx){return ctx.compose.build(ctx);},
    infoLine,
    manifestValues(){return null;}
  };
  registry.quarter={...definition};
  const B=global.OrderFlowBrief;
  registry.quarter.briefLevels=function({model}){
    const out=B.lines(model,'quarter').concat(B.regions(model,'quarter'));
    const current=(model.quarterVwaps||[]).find(x=>x.start===E.utcQuarterStart(model.last.time));
    const point=current&&current.points&&current.points[current.points.length-1];
    if(point){
      B.line(out,point.vwap,'本季 VWAP','quarter');
      B.line(out,point.upper,'本季 +1σ','quarter');
      B.line(out,point.lower,'本季 −1σ','quarter');
    }
    return out;
  };
  registry.quarter.briefStates=function({model}){
    const current=(model.quarterVwaps||[]).find(x=>x.start===E.utcQuarterStart(model.last.time));
    const point=current&&current.points&&current.points[current.points.length-1];
    const pq=model.pqStats;
    return B.present([
      point&&B.lineState('现价 vs 本季 VWAP',model.current,point.vwap,'quarter'),
      pq&&B.rangeState('现价 vs 上季价值区',model.current,pq.lower,pq.upper,'quarter')
    ]);
  };
})(typeof globalThis!=='undefined'?globalThis:window);
