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
    needs(ctx){
      const tf=ctx.state.timeframe,calc=ctx.state.rules.zones.calcIntervals[tf];
      const requested={[tf]:ctx.D.capFor(tf,tf,{}),'1h':5000,'30m':3500};
      if(calc)requested[calc]=Math.max(requested[calc]||0,ctx.D.capFor(calc,tf,{}));
      return requested;
    },
    build(ctx){return ctx.compose.build(ctx);},
    infoLine,
    manifestValues(){return null;}
  };
  registry.combined={...definition};
})(typeof globalThis!=='undefined'?globalThis:window);
