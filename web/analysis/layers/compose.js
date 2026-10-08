(function(global){
  'use strict';
  const registry=global.OrderFlowLayers=global.OrderFlowLayers||{};

  registry.compose={
    needs(){return{};},
    build(ctx){
      const {state,E,I,D,bundle,Layers,templates:T,symbolMeta,templateConfig,layerEnabled,windowSpec,defaultWindow,profileTemplate,extrema,yearVwapSegments,colorAlpha,monthLabelFromStart,nextMonthStartSec,normalizeTpoPeriod,weekLabel,fmtPrice,documentRoot:$}=ctx;
  function regionLayerEnabled(r){if(r.scope==='WEEKLY_PROJECTION')return layerEnabled('weeklyProjection');if(r.scope==='MONTHLY_IMBALANCE')return layerEnabled('monthlyStructure');if(r.scope==='MPROFILE_BOX')return layerEnabled('mprofile');if(r.scope==='WPROFILE_REF')return layerEnabled('wprofile');if(r.scope==='SINGLE_PRINT')return profileTemplate();if(r.type!=='value')return layerEnabled('zones');if(r.scope==='PQ')return layerEnabled('pqArea');if(r.scope==='PM')return layerEnabled('pm');if(r.scope==='PW')return layerEnabled('pw');return true;}
  function levelLayerEnabled(l){if(l.kind==='pq')return layerEnabled('pqVwap');if(l.kind==='pq-bound')return layerEnabled('pqBounds');if(l.kind==='npoc')return layerEnabled('nPoc');if(l.kind==='key')return layerEnabled('keyLevels');if(l.kind==='year')return layerEnabled('yearLevels');if(l.kind==='weekly'||l.kind==='weekly-pw')return layerEnabled('weeklyVwap');if(l.kind==='year-open')return layerEnabled('yearOpen');if(l.kind==='monthly-sr')return layerEnabled('monthlyStructure');if(l.kind==='mprofile')return layerEnabled('mprofile');if(l.kind==='wprofile')return layerEnabled('wprofile');return true;}

  function distancePct(current,bottom,top){
    if(current>=bottom&&current<=top)return 0;
    const d=current>top?current-top:bottom-current;return Math.abs(d/current*100);
  }
  function zoneStateText(r){
    if(r.zoneState==='inside')return'测试中';
    if(r.zoneState==='breaking')return'击穿待确认';
    return r.tested?'已测试':'未测试';
  }
  function sourceRows(payload){
    const out=[],current=payload.current;
    for(const r of payload.regions){
      let status=r.type==='supply'||r.type==='demand'?zoneStateText(r):(r.tested?'已测试':'未测试');
      if(r.offView)status+='（图外）';
      out.push({
        type:r.tableType||r.label,low:r.bottom,high:r.top,distance:distancePct(current,r.bottom,r.top),
        status,period:r.period||'',source:r.source||'exact',missing:false
      });
    }
    let hiddenKeyCount=0;
    for(const l of payload.levels){
      if(l.kind==='key'&&l.offView){hiddenKeyCount++;continue;}
      let status=l.kind==='npoc'?'未回补':'有效';if(l.offView)status+='（图外）';
      out.push({type:l.label,low:l.price,high:l.price,distance:Math.abs(l.price-current)/current*100,status,period:l.period||'',source:l.source||'exact',missing:false});
    }
    if(hiddenKeyCount>0)out.push({
      type:'关键价位 · 另有 '+hiddenKeyCount+' 条不在当前视图',low:null,high:null,distance:null,status:'图外',
      period:'',source:'precomputed',missing:false,summary:true
    });
    for(const m of payload.missing||[])out.push({type:m.type,low:null,high:null,distance:null,status:'缺失',period:m.period||'',source:m.source||'',missing:true});
    out.sort((a,b)=>{
      const ap=a.high==null?-Infinity:a.high,bp=b.high==null?-Infinity:b.high;
      return bp-ap||String(a.type).localeCompare(String(b.type));
    });
    return E.capTableRows(out,16);
  }


  function aggregateDisplay(bars,timeframe){
    if(timeframe==='1h')return (bars||[]).slice();
    const step=timeframe==='4h'?14400:(timeframe==='1d'?86400:3600),groups=new Map();
    for(const b of bars||[]){
      const key=Math.floor(Number(b.time)/step)*step;let g=groups.get(key);
      if(!g){g={time:key,openTime:key*1000,closeTime:0,open:Number(b.open),high:Number(b.high),low:Number(b.low),close:Number(b.close),volume:0,quoteVolume:0,takerBuyBase:0,takerBuyQuote:0,trades:0,count:0};groups.set(key,g);}
      g.high=Math.max(g.high,Number(b.high));g.low=Math.min(g.low,Number(b.low));g.close=Number(b.close);g.closeTime=Math.max(Number(g.closeTime)||0,Number(b.closeTime)||0);
      g.volume+=Number(b.volume)||0;g.quoteVolume+=Number(b.quoteVolume)||0;g.takerBuyBase+=Number(b.takerBuyBase)||0;g.takerBuyQuote+=Number(b.takerBuyQuote)||0;g.trades+=Number(b.trades)||0;g.count++;
    }
    const expected=timeframe==='4h'?4:24;
    return Array.from(groups.values()).filter(g=>g.count===expected).sort((a,b)=>a.time-b.time);
  }

  function quarterDisplay(bundle,timeframe){
    const raw=(bundle.series[timeframe]||bundle.series.display||[]),one=bundle.series['1h']||[];
    const last=(raw.length?raw[raw.length-1]:(one.length?one[one.length-1]:null));if(!last)return[];
    const start=E.previousQuarterStart(last.time);
    if(timeframe==='4h'&&one.length&&(!raw.length||Number(raw[0].time)>start+14400))return aggregateDisplay(one.filter(b=>Number(b.time)>=start),timeframe);
    return raw.filter(b=>Number(b.time)>=start);
  }



  function templateBuildContext(id,bundle,display,view){
    return{
      id,state,E,I,D,bundle,display,view,layerEnabled,symbolMeta,extrema,yearVwapSegments,colorAlpha,
      monthLabelFromStart,nextMonthStartSec,normalizeTpoPeriod,weekLabel,fmtPrice
    };
  }
  function buildTemplate(id,bundle,display,view,empty){
    const handler=T[id];
    if(!handler||state.template!==id||typeof handler.build!=='function')return empty;
    return handler.build(templateBuildContext(id,bundle,display,view));
  }

  function buildAnalysis(bundle){
    const rules=state.rules,tick=Number(symbolMeta().tickSize)||.01,counts=rules.display.bars;
    const source=bundle.series[state.timeframe]||bundle.series.display||[],win=windowSpec();
    const recentCount=Number(win.visibleBars)||Number(counts[state.timeframe])||540;
    const display=win.mode==='quarter'?quarterDisplay(bundle,state.timeframe):source.slice(-recentCount);
    if(!display.length)throw new Error('display data missing for '+state.timeframe);
    const visibleN=win.mode==='quarter'?display.length:Math.min(display.length,Number(win.visibleBars)||defaultWindow(display.length).visible);
    const viewBars=win.mode==='quarter'||visibleN>=display.length?display:display.slice(-visibleN),view=extrema(viewBars);
    const one=bundle.series['1h']||[],thirty=bundle.series['30m']||[],calcTf=rules.zones.calcIntervals[state.timeframe],calc=bundle.series[calcTf]||[];
    const last=display[display.length-1],current=Number(last.close),qStart=E.utcQuarterStart(last.time),pqStart=E.previousQuarterStart(last.time),missing=[];
    const valueAreaModel=Layers.valueAreas.build({
      state,E,bundle,display,view,layerEnabled,symbolMeta,templateConfig
    });
    missing.push(...valueAreaModel.missing);
    const {allAreas,drawnAreaIds,pqStats,pw,weekEnd,pq}=valueAreaModel;

    const asOfMs=state.snapshot&&bundle.cutoffUtc?Date.parse(bundle.cutoffUtc)+1000:Date.now();
    const closedCalc=D.closedBars(calc,asOfMs);
    const zonesModel=Layers.zones.build({
      state,E,D,bundle,view,current,layerEnabled
    });
    missing.push(...zonesModel.missing);
    const {selectedZones,drawnZoneIds}=zonesModel;

    const allLevels=[];
    const weeklyModel=buildTemplate('weekly',bundle,display,view,{curves:[],regions:[],levels:[],segments:[],projections:[],yearOpen:null});
    const monthlyModel=buildTemplate('monthly',bundle,display,view,{levels:[],regions:[],upper:null,lower:null,imbalance:null});
    const mprofileModel=buildTemplate(
      'mprofile',
      bundle,
      display,
      view,
      {profiles:[],levels:[],regions:[],current:null,box:null,naked:[],priceWindow:null}
    );
    const wprofileModel=buildTemplate(
      'wprofile',
      bundle,
      display,
      view,
      {profiles:[],levels:[],regions:[],current:null,naked:[],extensions:[],priceWindow:null}
    );
    allLevels.push(...valueAreaModel.levels);

    const npocModel=Layers.npoc.build({
      state,E,bundle,display,current,layerEnabled,symbolMeta,
      layers:{valueAreas:valueAreaModel}
    });
    allLevels.push(...npocModel.levels);

    const linePad=rules.valueAreas.visiblePadPct;
    const keyPane=state.chart&&state.chart.panes&&state.chart.panes()[0];
    const keyPaneHeight=keyPane&&typeof keyPane.getHeight==='function'
      ?keyPane.getHeight()
      :$('analysisChart').clientHeight;
    const keyScaleMargins=state.candles&&state.candles.priceScale
      ?state.candles.priceScale().options().scaleMargins
      :null;
    const keyUsableRatio=Math.max(
      .1,
      1-Math.max(0,Number(keyScaleMargins&&keyScaleMargins.top)||0)
        -Math.max(0,Number(keyScaleMargins&&keyScaleMargins.bottom)||0)
    );
    const keyPlotHeight=keyPaneHeight*keyUsableRatio;
    const keyLevelModel=Layers.keyLevels.build({
      state,E,D,bundle,display,current,view,layerEnabled,templateConfig,tick,
      previousQuarterStart:pqStart,
      linePad,
      plotHeight:keyPlotHeight,
      templateKeyStyle:templateConfig().keyLevelStyle||{},
      layers:{valueAreas:valueAreaModel}
    });
    missing.push(...keyLevelModel.missing);
    allLevels.push(...keyLevelModel.levels);

    allLevels.push(...weeklyModel.levels,...monthlyModel.levels,...mprofileModel.levels,...wprofileModel.levels);
    const selectedKeyIds=keyLevelModel.selectedIds;
    const weeklyRegionIds=new Set(weeklyModel.regions.map(r=>r.id)),monthlyRegionIds=new Set(monthlyModel.regions.map(r=>r.id)),mprofileRegionIds=new Set(mprofileModel.regions.map(r=>r.id)),wprofileRegionIds=new Set(wprofileModel.regions.map(r=>r.id));
    const drawnLevelIds=new Set(allLevels.filter(l=>{
      if(l.kind==='key'||l.kind==='year')return selectedKeyIds.has(l.id);
      if(l.kind==='monthly-sr'||l.kind==='mprofile'||l.kind==='wprofile')return true;
      if(l.pairedRegionId)return weeklyRegionIds.has(l.pairedRegionId);
      return E.inPriceView(l.price,view.min,view.max,linePad);
    }).map(l=>l.id));

    const allRegions=allAreas.concat(selectedZones,weeklyModel.regions,monthlyModel.regions,mprofileModel.regions,wprofileModel.regions).map(r=>({...r,offView:(weeklyRegionIds.has(r.id)||monthlyRegionIds.has(r.id)||mprofileRegionIds.has(r.id)||wprofileRegionIds.has(r.id))?false:(r.type==='value'?!drawnAreaIds.has(r.id):!drawnZoneIds.has(r.id))}));
    const levelsForTable=allLevels.map(l=>({...l,offView:!drawnLevelIds.has(l.id)}));
    const regions=allRegions.filter(r=>!r.offView&&regionLayerEnabled(r)),levels=levelsForTable.filter(l=>!l.offView&&levelLayerEnabled(l));

    const quarterLayer=Layers.quarterBands.build({state,E,I,D,bundle,display});
    const quarterVwaps=quarterLayer.quarterVwaps;
    const rvwapModel=buildTemplate('rvwap',bundle,display,view,{curves:[],rolling:{},yearSegments:[]});
    const profileModels={mprofile:mprofileModel,wprofile:wprofileModel};
    const activeHandler=T[state.template];
    const activeProfileModel=activeHandler&&activeHandler.modelKey?profileModels[activeHandler.modelKey]:null;
    const profileWindow=activeProfileModel&&activeProfileModel.priceWindow||null;
    const currentVwap=quarterLayer.currentVwap;
    const lastClosed=closedCalc[closedCalc.length-1];
    const calcLastClosedUtc=lastClosed?new Date(Number(lastClosed.closeTime)+1).toISOString():null;
    return{
      symbol:state.symbol,timeframe:state.timeframe,display,last,current,regions,levels,currentVwap,quarterVwaps,pqStats,keyLevels:levels.filter(l=>l.kind==='key'),yearLevels:levels.filter(l=>l.kind==='year'),curves:(rvwapModel.curves||[]).concat(weeklyModel.curves||[]),rvwap:rvwapModel,weekly:weeklyModel,monthly:monthlyModel,mprofile:mprofileModel,wprofile:wprofileModel,profiles:activeProfileModel?(activeProfileModel.profiles||[]):[],missing,
      allRegions,allLevels:levelsForTable,viewMin:profileWindow?profileWindow.min:view.min,viewMax:profileWindow?profileWindow.max:view.max,profileWindow,visibleBars:visibleN,
      cutoffUtc:bundle.cutoffUtc||null,generatedAt:bundle.generatedAt||new Date().toISOString(),
      calcTf,calcLastClosedUtc,bundleErrors:bundle.errors||{},
      tableRows:templateConfig().table===false?[]:sourceRows({regions:allRegions,levels:levelsForTable,current,missing})
    };
  }


      return buildAnalysis(bundle);
    }
  };
})(typeof globalThis!=='undefined'?globalThis:window);
