(function(global){
  'use strict';

  const registry=global.OrderFlowLayers=global.OrderFlowLayers||{};

  function fillAlpha(base,tested){
    if(!tested)return base;
    if(base.startsWith('rgba('))return base.replace(/,[^,]+\)$/g,',.08)');
    return base;
  }

  registry.zones={
    needs(ctx){
      const {state,layerEnabled}=ctx;
      if(!layerEnabled('zones'))return{};
      const interval=state.rules.zones.calcIntervals[state.timeframe];
      return interval?{[interval]:Number(state.rules.zones.calcBars)||400}:{};
    },

    build(ctx){
      const {state,E,D,bundle,view,current,layerEnabled}=ctx;
      const rules=state.rules;
      const calcTf=rules.zones.calcIntervals[state.timeframe];
      const empty={selectedZones:[],drawnZoneIds:new Set(),missing:[],calcTf};
      if(!layerEnabled('zones'))return empty;

      const calc=bundle.series[calcTf]||[];
      const asOfMs=state.snapshot&&bundle.cutoffUtc
        ?Date.parse(bundle.cutoffUtc)+1000
        :Date.now();
      const closedCalc=D.closedBars(calc,asOfMs);
      const missing=[];
      let selectedZones=[];
      if(closedCalc.length){
        const detected=E.detectZones(closedCalc,rules.zones);
        selectedZones=E.selectZones(
          E.markZoneTouches(detected,calc),
          current,
          rules.zones
        ).map(zone=>{
          const supply=zone.type==='supply';
          const baseFill=supply?rules.colors.supplyFill:rules.colors.demandFill;
          const border=supply?rules.colors.supplyBorder:rules.colors.demandBorder;
          const stateText=zone.zoneState==='inside'
            ?'·测试中'
            :(zone.zoneState==='breaking'?'·击穿待确认':(zone.tested?'·已测试':''));
          return{
            ...zone,
            type:zone.type,
            fill:fillAlpha(baseFill,zone.tested),
            border,
            period:calcTf,
            source:'exact',
            label:(supply?'供应区':'需求区')+stateText+' · '+calcTf.toUpperCase()+' · '+zone.strength.toFixed(1)+'ATR',
            tableType:supply?'供应区':'需求区'
          };
        });
      }else{
        missing.push({type:'供应/需求区',period:calcTf,source:'exact'});
      }

      const drawnZoneIds=new Set(
        selectedZones
          .filter(zone=>E.zoneIntersectsView(
            zone,
            view.min,
            view.max,
            rules.zones.viewPadPct||50
          ))
          .map(zone=>zone.id)
      );
      return{selectedZones,drawnZoneIds,missing,calcTf};
    }
  };
})(typeof globalThis!=='undefined'?globalThis:window);
