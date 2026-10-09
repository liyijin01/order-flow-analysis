(function(global){
  'use strict';

  const registry=global.OrderFlowLayers=global.OrderFlowLayers||{};

  function periodEndFromProfile(profile){
    const previous=profile&&profile.profiles&&profile.profiles.previous;
    const days=previous&&(previous.expectedDays||previous.days);
    if(!days||!days.length)return null;
    return Date.parse(days[days.length-1]+'T00:00:00Z')/1000+86400;
  }

  function previousWeekTpo(ctx,thirty,lastTime,tickSize){
    const {E,state}=ctx;
    const weekEnd=E.utcWeekStart(lastTime);
    const weekStart=weekEnd-7*86400;
    const bars=thirty.filter(bar=>bar.time>=weekStart&&bar.time<weekEnd);
    if(!bars.length)return null;
    const profile=E.tpoProfile(
      bars,
      tickSize*Number(state.rules.nakedPoc.tpoTicksPerRow||100)
    );
    return profile&&Number.isFinite(profile.poc)
      ?{...profile,from:weekEnd,bars}
      :null;
  }

  function previousMonthArea(ctx,oneHour,thirty,lastTime){
    const {state,E,symbolMeta}=ctx;
    const cfg=state.rules.valueAreas.pm;
    const definition=cfg.definition;
    const monthStart=E.utcMonthStart(lastTime);
    const previousStart=E.previousMonthStart(lastTime);
    if(definition==='tpo-70'){
      const bars=thirty.filter(bar=>bar.time>=previousStart&&bar.time<monthStart);
      const profile=E.tpoProfile(
        bars,
        (Number(symbolMeta().tickSize)||.01)*Number(state.rules.nakedPoc.tpoTicksPerRow||100)
      );
      if(profile&&Number.isFinite(profile.vah)){
        return{
          bottom:profile.val,
          top:profile.vah,
          mid:profile.poc,
          source:'approx',
          definition
        };
      }
      return null;
    }
    const bars=oneHour.filter(bar=>bar.time>=previousStart&&bar.time<monthStart);
    if(!bars.length)return null;
    if(definition==='anchored-vwap-2sigma'){
      const stats=E.weightedStats(bars);
      if(!stats)return null;
      return{
        bottom:stats.vwap-2*stats.sigma,
        top:stats.vwap+2*stats.sigma,
        mid:stats.vwap,
        source:'approx',
        definition
      };
    }
    const profile=E.approxVolumeProfile(bars,Number(symbolMeta().ladderBin)||.1);
    if(!profile||!Number.isFinite(profile.vah))return null;
    return{
      bottom:profile.val,
      top:profile.vah,
      mid:profile.poc,
      source:'approx',
      definition:'volume-profile-70'
    };
  }

  registry.valueAreas={
    needs(ctx){
      const {layerEnabled}=ctx;
      const out={};
      if(layerEnabled('pqArea')||layerEnabled('pqBounds')||layerEnabled('pqVwap'))out['1h']=5000;
      if(layerEnabled('pm')||layerEnabled('pw')||layerEnabled('nPoc'))out['30m']=3500;
      return out;
    },

    build(ctx){
      const {
        state,E,bundle,display,view,layerEnabled,symbolMeta,templateConfig
      }=ctx;
      const rules=state.rules;
      const tick=Number(symbolMeta().tickSize)||.01;
      const oneHour=bundle.series['1h']||[];
      const thirty=bundle.series['30m']||[];
      const last=display[display.length-1];
      const quarterStart=E.utcQuarterStart(last.time);
      const previousQuarterStart=E.previousQuarterStart(last.time);
      const areas=[];
      const missing=[];
      let pqStats=null;
      let pw=null;
      let weekEnd=null;

      const needPq=layerEnabled('pqArea')||layerEnabled('pqBounds')||layerEnabled('pqVwap');
      if(needPq){
        const bars=oneHour.filter(
          bar=>bar.time>=previousQuarterStart&&bar.time<quarterStart
        );
        pqStats=E.weightedStats(bars);
        if(pqStats&&bars.length&&bars[0].time<=previousQuarterStart+3600){
          areas.push({
            id:'value-pq',
            type:'value',
            scope:'PQ',
            bottom:pqStats.lower,
            top:pqStats.upper,
            from:quarterStart,
            label:'上季价值区 PQ',
            tableType:'价值区 PQ',
            period:'Q / 1h',
            source:'exact',
            tested:E.wasZoneTouched(oneHour,quarterStart,pqStats.lower,pqStats.upper),
            fill:rules.colors.pqFill,
            border:rules.colors.pqBorder,
            borderStyle:'dashed',
            pqVwap:pqStats.vwap
          });
        }else{
          missing.push({type:'价值区 PQ',period:'Q / 1h',source:'exact'});
        }
      }

      if(layerEnabled('pm')){
        const pm=previousMonthArea(ctx,oneHour,thirty,last.time);
        const monthStart=E.utcMonthStart(last.time);
        if(pm){
          areas.push({
            id:'value-pm',
            type:'value',
            scope:'PM',
            bottom:pm.bottom,
            top:pm.top,
            from:monthStart,
            label:'上月价值区 PM'+(pm.source==='approx'?' ≈':''),
            tableType:'价值区 PM',
            period:'M / '+(pm.definition==='tpo-70'?'30m TPO':'1h'),
            source:pm.source,
            tested:E.wasZoneTouched(oneHour,monthStart,pm.bottom,pm.top),
            fill:rules.colors.pmFill,
            border:rules.colors.pmBorder
          });
        }else{
          missing.push({type:'价值区 PM',period:'M',source:'approx'});
        }
      }

      if(layerEnabled('pw')||layerEnabled('nPoc')){
        const weekAsOf=state.snapshot&&bundle.cutoffUtc
          ?(Date.parse(bundle.cutoffUtc)+1000)/1000
          :Date.now()/1000;
        const profileFresh=E.profileIsFresh(bundle.profile,weekAsOf);
        const exactPw=profileFresh?E.exactProfile(bundle.profile):null;
        const exactWeekEnd=profileFresh?periodEndFromProfile(bundle.profile):null;
        const fallbackPw=!exactPw?previousWeekTpo(ctx,thirty,weekAsOf,tick):null;
        if(exactPw&&exactWeekEnd){
          pw={...exactPw,source:'exact'};
          weekEnd=exactWeekEnd;
          if(layerEnabled('pw')){
            areas.push({
              id:'value-pw',
              type:'value',
              scope:'PW',
              bottom:pw.val,
              top:pw.vah,
              from:weekEnd,
              label:'上周价值区 PW',
              tableType:'价值区 PW',
              period:'W / aggTrades',
              source:'exact',
              tested:E.wasZoneTouched(
                thirty.length?thirty:oneHour,
                weekEnd,
                pw.val,
                pw.vah
              ),
              fill:rules.colors.pwFill,
              border:rules.colors.pwBorder
            });
          }
        }else if(fallbackPw){
          pw={...fallbackPw,source:'approx'};
          weekEnd=fallbackPw.from;
          if(layerEnabled('pw')){
            areas.push({
              id:'value-pw-tpo',
              type:'value',
              scope:'PW',
              bottom:pw.val,
              top:pw.vah,
              from:weekEnd,
              label:'上周价值区 PW ≈',
              tableType:'价值区 PW',
              period:'W / 30m TPO',
              source:'approx',
              tested:E.wasZoneTouched(thirty,weekEnd,pw.val,pw.vah),
              fill:rules.colors.pwFill,
              border:rules.colors.pwBorder
            });
          }
        }else if(layerEnabled('pw')){
          missing.push({
            type:'价值区 PW',
            period:'W / aggTrades or 30m TPO',
            source:'approx'
          });
        }
      }

      const allAreas=E.suppressValueAreas(
        areas,
        rules.valueAreas.overlapSuppressPct,
        rules.valueAreas.maxCount||3
      );
      const drawnAreaIds=new Set(
        E.filterValueAreas(
          allAreas,
          view.min,
          view.max,
          rules.valueAreas.visiblePadPct,
          rules.valueAreas.overlapSuppressPct
        ).map(item=>item.id)
      );
      const pq=areas.find(item=>item.scope==='PQ')||null;
      const levels=[];
      const keyStyle=templateConfig().keyLevelStyle||{};
      if(pq&&layerEnabled('pqVwap')){
        levels.push({
          id:'line-pq-vwap',
          kind:'pq',
          price:pq.pqVwap,
          from:quarterStart,
          label:'PQ VWAP',
          color:rules.colors.pqVwap,
          axisColor:rules.colors.pqVwap,
          axisTextColor:'#eceff4',
          axisLabel:true,
          style:'solid',
          period:'Q / 1h',
          source:'exact'
        });
      }
      if(pq&&layerEnabled('pqBounds')){
        levels.push(
          {
            id:'line-pq-vah',
            kind:'pq-bound',
            price:pq.top,
            from:quarterStart,
            label:'PQ VAH',
            color:rules.colors.keyLevel,
            axisColor:keyStyle.axisColor||rules.colors.keyAxis,
            axisTextColor:keyStyle.axisTextColor||'#111827',
            axisLabel:keyStyle.axisLabel!==false,
            style:'dashed',
            width:1,
            period:'Q / 1h VWAP±1σ',
            source:'exact'
          },
          {
            id:'line-pq-val',
            kind:'pq-bound',
            price:pq.bottom,
            from:quarterStart,
            label:'PQ VAL',
            color:rules.colors.keyLevel,
            axisColor:keyStyle.axisColor||rules.colors.keyAxis,
            axisTextColor:keyStyle.axisTextColor||'#111827',
            axisLabel:keyStyle.axisLabel!==false,
            style:'dashed',
            width:1,
            period:'Q / 1h VWAP±1σ',
            source:'exact'
          }
        );
      }
      return{
        areas,
        allAreas,
        drawnAreaIds,
        levels,
        missing,
        pq,
        pqStats,
        pw,
        weekEnd
      };
    }
  };
})(typeof globalThis!=='undefined'?globalThis:window);
