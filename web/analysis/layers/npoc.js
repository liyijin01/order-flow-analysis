(function(global){
  'use strict';

  const registry=global.OrderFlowLayers=global.OrderFlowLayers||{};

  function previousMonthTpo(ctx,thirty,lastTime,tickSize){
    const {E,state}=ctx;
    const monthStart=E.utcMonthStart(lastTime);
    const previousStart=E.previousMonthStart(lastTime);
    const bars=thirty.filter(
      bar=>bar.time>=previousStart&&bar.time<monthStart
    );
    if(!bars.length)return null;
    const profile=E.tpoProfile(
      bars,
      tickSize*Number(state.rules.nakedPoc.tpoTicksPerRow||100)
    );
    return profile&&Number.isFinite(profile.poc)
      ?{...profile,from:monthStart,bars}
      :null;
  }

  registry.npoc={
    needs(ctx){
      return ctx.layerEnabled('nPoc')?{'30m':3500}:{};
    },

    build(ctx){
      const {
        state,E,bundle,display,current,layerEnabled,symbolMeta,layers
      }=ctx;
      if(!layerEnabled('nPoc'))return{levels:[]};

      const rules=state.rules;
      const tick=Number(symbolMeta().tickSize)||.01;
      const oneHour=bundle.series['1h']||[];
      const thirty=bundle.series['30m']||[];
      const valueAreas=layers&&layers.valueAreas||{};
      const pw=valueAreas.pw;
      const weekEnd=valueAreas.weekEnd;
      const candidates=[];

      if(pw&&weekEnd&&E.isPocNaked(
        pw.poc,
        weekEnd,
        thirty.length?thirty:oneHour
      )){
        candidates.push({
          id:pw.source==='exact'?'npoc-week':'npoc-week-tpo',
          kind:'npoc',
          price:pw.poc,
          from:weekEnd,
          label:pw.source==='exact'?'nPOC W':'nPOC W ≈',
          color:rules.colors.nPoc,
          style:'dashed',
          period:pw.source==='exact'?'W / aggTrades':'W / 30m TPO',
          source:pw.source
        });
      }

      const last=display[display.length-1];
      const month=previousMonthTpo(ctx,thirty,last.time,tick);
      if(month&&E.isPocNaked(month.poc,month.from,thirty)){
        candidates.push({
          id:'npoc-month',
          kind:'npoc',
          price:month.poc,
          from:month.from,
          label:'nPOC M ≈',
          color:rules.colors.nPoc,
          style:'dashed',
          period:'M / 30m TPO',
          source:'approx'
        });
      }
      return{
        levels:E.selectNakedPocs(
          candidates,
          current,
          rules.nakedPoc.maxCount
        )
      };
    }
  };
})(typeof globalThis!=='undefined'?globalThis:window);
