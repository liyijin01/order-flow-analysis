(function(global){
  'use strict';

  const registry=global.OrderFlowLayers=global.OrderFlowLayers||{};

  registry.keyLevels={
    needs(){
      return{};
    },

    build(ctx){
      const {
        state,E,D,bundle,display,current,view,layerEnabled,templateConfig,tick,layers
      }=ctx;
      const enabled=layerEnabled('keyLevels')||layerEnabled('yearLevels');
      if(!enabled){
        return{
          levels:[],
          selectedIds:new Set(),
          keySelection:{all:[],selected:[]},
          missing:[]
        };
      }

      const rules=state.rules;
      const valueAreas=layers&&layers.valueAreas||{};
      const pq=valueAreas.pq;
      const missing=[];
      const levels=[];
      let keySelection={all:[],selected:[]};

      if(bundle.keyLevels&&Array.isArray(bundle.keyLevels.levels)){
        const keyAsOfMs=state.snapshot&&bundle.cutoffUtc
          ?Date.parse(bundle.cutoffUtc)
          :Date.now();
        const closedDisplay=D.closedBars(display,keyAsOfMs);
        const lastClosed=closedDisplay[closedDisplay.length-1];
        const keyPeriodCutoffMs=lastClosed&&Number.isFinite(Number(lastClosed.closeTime))
          ?Number(lastClosed.closeTime)+1
          :keyAsOfMs;
        const cfg=templateConfig();
        const yearOnly=cfg.yearLevelsOnly===true;
        const eligible=bundle.keyLevels.levels.filter(row=>{
          const periodEnd=Date.parse(String(row.periodEnd||''));
          const yearly=row.kind==='year';
          const templateOk=yearOnly?yearly:!yearly;
          return templateOk&&Number.isFinite(periodEnd)&&periodEnd<=keyPeriodCutoffMs;
        });

        const keyCfg=rules.keyLevels||{};
        const pane=state.chart&&state.chart.panes&&state.chart.panes()[0];
        const root=document.getElementById('analysisChart');
        const paneHeight=pane&&typeof pane.getHeight==='function'
          ?pane.getHeight()
          :(root?root.clientHeight:0);
        const scaleMargins=state.candles&&state.candles.priceScale
          ?state.candles.priceScale().options().scaleMargins
          :null;
        const usableRatio=Math.max(
          .1,
          1-Math.max(0,Number(scaleMargins&&scaleMargins.top)||0)
            -Math.max(0,Number(scaleMargins&&scaleMargins.bottom)||0)
        );
        const plotHeight=paneHeight*usableRatio;
        const last=display[display.length-1];
        const previousQuarterStart=E.previousQuarterStart(last.time);
        const reserve=yearOnly||!pq?[]:[pq.pqVwap,pq.bottom,pq.top];

        keySelection=E.selectKeyLevels(
          eligible,
          current,
          view.min,
          view.max,
          rules.valueAreas.visiblePadPct,
          tick,
          keyCfg.maxCount||6,
          previousQuarterStart,
          keyCfg.maxMonthly||2,
          keyCfg.minGapPct||2,
          reserve,
          keyCfg.minGapPx||0,
          plotHeight
        );

        const firstTime=Number(display[0].time);
        const keyStyle=cfg.keyLevelStyle||{};
        const rvwapCfg=rules.rvwap||{};
        for(const row of keySelection.all){
          const monthly=row.keyKind==='py-month';
          const yearly=row.kind==='year';
          const yearVwap=yearly&&row.side==='VWAP';
          levels.push({
            id:(yearly?'year-':'key-')+row.id,
            kind:yearly?'year':'key',
            price:Number(row.price),
            from:firstTime,
            label:row.label,
            color:yearVwap
              ?(rvwapCfg.historicalVwap||'#f5a623')
              :(keyStyle.color||(monthly?rules.colors.keyMonth:rules.colors.keyLevel)),
            axisColor:yearVwap
              ?(rvwapCfg.historicalVwap||'#f5a623')
              :(keyStyle.axisColor||rules.colors.keyAxis),
            axisTextColor:yearly?'#eceff4':(keyStyle.axisTextColor||'#111827'),
            axisLabel:true,
            style:yearVwap?'solid':(keyStyle.style||(monthly?'solid':'dashed')),
            width:yearVwap?1.5:1,
            period:yearly
              ?'Y / 4h VWAP±1σ'
              :(monthly?'M / 30m TPO':'Q / 1h VWAP±1σ'),
            source:'precomputed',
            keyKind:row.keyKind,
            sourceId:row.id,
            side:row.side
          });
        }
      }else{
        missing.push({
          type:'关键价位',
          period:'Q / 1h VWAP±1σ + M / 30m TPO',
          source:'precomputed'
        });
      }

      const selectedIds=new Set(
        keySelection.selected.map(row=>(row.kind==='year'?'year-':'key-')+row.id)
      );
      return{levels,selectedIds,keySelection,missing};
    }
  };
})(typeof globalThis!=='undefined'?globalThis:window);
