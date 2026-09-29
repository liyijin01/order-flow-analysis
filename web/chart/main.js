(function () {
  'use strict';

  const L=window.LightweightCharts,T=window.OrderFlowChartTheme,D=window.OrderFlowChartData,E=window.OrderFlowChartExport;
  const R=window.OrderFlowRealtime,I=window.OrderFlowIndicators,A=window.OrderFlowAnnotate,AR=window.OrderFlowAnnotationRenderer;
  const PRESETS=window.OrderFlowChartPresets||{},SYMBOLS=window.ORDER_FLOW_SYMBOLS||{};
  const $=(id)=>document.getElementById(id),container=$('chart'),status=$('status'),infoLine1=$('infoLine1'),infoLine2=$('infoLine2'),footerLocal=$('footerLocal');

  const state={
    symbol:'BTCUSDT',market:'um',interval:'1h',candleStyle:'mono',fixture:'none',autoPreset:'none',annotationAutoscale:true,
    data:[],byTime:new Map(),chart:null,candles:null,volume:null,watermark:null,countdownLine:null,annotations:null,
    loadToken:0,latestRefreshBusy:false,annotationStats:{rendered:0,skipped:0,errors:[]},rules:null,lastStatusBase:''
  };

  function setStatus(message,isError){status.textContent=message;status.className=isError?'status error':'status';}
  function symbolMeta(){return SYMBOLS[state.symbol]||{base:state.symbol.replace('USDT',''),name:state.symbol,ladderBin:'1',tickSize:'0.01',tpoTicksPerRow:100};}
  function displayCode(){return D.displayCode(state.symbol,state.market);}
  function tickSize(){return Number(symbolMeta().tickSize)||0.01;}
  function pricePrecision(){return I.tickPrecision(tickSize());}
  function fmtPrice(value){
    const precision=pricePrecision(),rounded=I.roundToTick(Number(value),tickSize());
    return Number(rounded).toLocaleString(undefined,{minimumFractionDigits:precision,maximumFractionDigits:precision});
  }
  function fmtVolume(value){return Number(value).toLocaleString(undefined,{maximumFractionDigits:3});}

  function formatInfo(candle){
    if(!candle)return['',''];
    const change=candle.close-candle.open,pct=candle.open?change/candle.open*100:0,sign=change>=0?'+':'',meta=symbolMeta();
    const source=state.fixture!=='none'?'SAMPLE':(state.autoPreset!=='none'?'AUTO '+state.autoPreset.toUpperCase():'Binance');
    const line1=displayCode()+' · '+meta.name+' · '+D.intervalLabel(state.interval)+' · '+source+' · '+D.formatLocalDateTime(candle.time,false)+
      '  开='+fmtPrice(candle.open)+' 高='+fmtPrice(candle.high)+' 低='+fmtPrice(candle.low)+' 收='+fmtPrice(candle.close)+
      '  涨跌 '+sign+fmtPrice(change)+' ('+sign+pct.toFixed(2)+'%)  成交量 '+fmtVolume(candle.volume)+' '+meta.base;
    let line2='Volume ('+meta.base+') '+fmtVolume(candle.volume)+' · Quote '+Number(candle.quoteVolume).toLocaleString(undefined,{maximumFractionDigits:0})+' USDT · JST';
    if(state.autoPreset==='p1'&&state.annotations&&state.annotations.lastDocument){
      const band=state.annotations.lastDocument.items.find(x=>x.type==='band'&&x.label==='Q VWAP');
      const p=band&&band.points&&band.points[band.points.length-1];
      if(p)line2='Anchored VWAP (hlc3, Quarter, ±1σ)  '+fmtPrice(p[1])+' '+fmtPrice(p[2])+' '+fmtPrice(p[3])+' · '+line2;
    }
    return[line1,line2];
  }
  function updateInfo(candle){const lines=formatInfo(candle);infoLine1.textContent=lines[0];infoLine2.textContent=lines[1];}

  function candleOptions(){
    const common={borderVisible:true,lastValueVisible:false,priceLineVisible:false};
    return state.candleStyle==='color'
      ?{...common,upColor:T.colorUpFill,downColor:T.colorDownFill,borderUpColor:T.colorUpBorder,borderDownColor:T.colorDownBorder,wickUpColor:T.colorUpBorder,wickDownColor:T.colorDownBorder}
      :{...common,upColor:T.upColor,downColor:T.downColor,borderUpColor:T.upBorder,borderDownColor:T.downBorder,wickUpColor:T.upWick,wickDownColor:T.downWick};
  }

  function createChart(){
    if(!L)throw new Error('Lightweight Charts failed to load');
    const chart=L.createChart(container,{
      width:container.clientWidth,height:container.clientHeight,
      layout:{background:{type:'solid',color:T.background},textColor:T.text,attributionLogo:true,panes:{separatorColor:T.border,separatorHoverColor:'rgba(255,255,255,.22)',enableResize:true}},
      grid:{vertLines:{color:T.grid},horzLines:{color:T.grid}},
      localization:{locale:'ja-JP',timeFormatter:(time)=>D.formatDisplayDateTime(time,false)},
      rightPriceScale:{borderColor:T.border},
      timeScale:{borderColor:T.border,timeVisible:true,secondsVisible:false,tickMarkFormatter:(time,type,locale)=>D.formatDisplayTick(time,type,locale)},
      crosshair:{mode:L.CrosshairMode.Normal}
    });
    const candles=chart.addSeries(L.CandlestickSeries,{...candleOptions(),priceFormat:{type:'price',precision:pricePrecision(),minMove:tickSize()}},0);
    const volume=chart.addSeries(L.HistogramSeries,{priceFormat:{type:'volume'},priceLineVisible:false,lastValueVisible:false},1);
    const panes=chart.panes();if(panes[1])panes[1].setHeight(Math.max(100,Math.round(container.clientHeight*.19)));
    const watermark=L.createTextWatermark(chart.panes()[0],{horzAlign:'center',vertAlign:'center',lines:[{text:displayCode()+', '+D.intervalLabel(state.interval),color:T.watermark,fontSize:42,fontStyle:'bold'}]});
    new ResizeObserver(()=>{chart.resize(container.clientWidth,container.clientHeight);const ps=chart.panes();if(ps[1])ps[1].setHeight(Math.max(90,Math.round(container.clientHeight*.19)));state.annotations&&state.annotations.relayoutLabels();}).observe(container);
    chart.subscribeCrosshairMove((param)=>{
      if(!param||!param.time){updateInfo(state.data[state.data.length-1]);return;}
      const candle=state.byTime.get(Number(param.time));updateInfo(candle||state.data[state.data.length-1]);
      const hoveredId=param.hoveredObjectId||(param.hoveredTarget&&param.hoveredTarget.objectId)||(param.hoveredItem&&param.hoveredItem.externalId);
      const hoverText=state.annotations&&state.annotations.hoverText(hoveredId);
      if(hoverText)infoLine2.textContent=hoverText+' · '+infoLine2.textContent;
    });
    let visibleTimer=null;
    chart.timeScale().subscribeVisibleLogicalRangeChange(()=>{
      if(state.annotations)state.annotations.relayoutLabels();
      clearTimeout(visibleTimer);
      visibleTimer=setTimeout(async()=>{
        if(state.autoPreset!=='none'&&state.fixture==='none'){
          try{await renderSelectedAnnotations();updateInfo(state.data[state.data.length-1]);}
          catch(error){console.warn('visible-range annotation refresh failed',error);}
        }
      },150);
    });
    state.chart=chart;state.candles=candles;state.volume=volume;state.watermark=watermark;state.annotations=new AR.AnnotationRenderer(chart,candles);
  }

  function updateWatermark(){
    if(!state.watermark)return;
    const lines=state.fixture!=='none'
      ?[{text:'SAMPLE 样例数据',color:'rgba(255,190,90,.22)',fontSize:48,fontStyle:'bold'},{text:displayCode()+', '+D.intervalLabel(state.interval),color:T.watermark,fontSize:32,fontStyle:'bold'}]
      :[{text:displayCode()+', '+D.intervalLabel(state.interval),color:T.watermark,fontSize:42,fontStyle:'bold'}];
    state.watermark.applyOptions({lines});
  }

  function seriesData(rows){
    return{
      candles:rows.map(c=>({time:D.toDisplayTime(c.time),open:c.open,high:c.high,low:c.low,close:c.close})),
      volumes:rows.map(c=>({time:D.toDisplayTime(c.time),value:c.volume,color:c.close>=c.open?T.volumeUp:T.volumeDown}))
    };
  }

  function annotationContext(){
    return{bars:state.data,intervalSec:D.intervalSec(state.interval),autoscale:state.annotationAutoscale,timeOffsetSec:D.JST_OFFSET_SEC,priceFormatter:fmtPrice};
  }

  function updateCountdown(){
    const last=state.data[state.data.length-1];if(!last||!state.candles)return;
    const title=fmtPrice(last.close)+' · '+D.remainingText(last.closeTime,Date.now());
    if(!state.countdownLine){
      state.countdownLine=state.candles.createPriceLine({price:last.close,color:T.white,lineVisible:false,axisLabelVisible:true,title});
    }else state.countdownLine.applyOptions({price:last.close,title,color:T.white,axisLabelVisible:true});
  }

  function applyUiState(){
    $('pageTitle').textContent=displayCode()+' · '+D.intervalLabel(state.interval);
    updateWatermark();
    if(state.chart)state.chart.applyOptions({timeScale:{tickMarkFormatter:(time,type,locale)=>D.formatDisplayTick(time,type,locale)},localization:{locale:'ja-JP',timeFormatter:(time)=>D.formatDisplayDateTime(time,false)}});
    if(state.candles)state.candles.applyOptions({...candleOptions(),priceFormat:{type:'price',precision:pricePrecision(),minMove:tickSize()}});
    if(state.annotations)state.annotations.setContext(annotationContext());
  }

  async function loadRules(){
    if(state.rules)return state.rules;
    const response=await fetch('config/annotation-rules.json',{cache:'no-store'});if(!response.ok)throw new Error('annotation rules HTTP '+response.status);
    state.rules=await response.json();return state.rules;
  }

  function desiredBars(){
    if(state.autoPreset==='p1')return 16000;
    if(state.autoPreset==='p2')return 5200;
    if(state.autoPreset==='p3')return 3600;
    if(state.autoPreset==='p4')return 9000;
    return state.market==='spot'?1000:1500;
  }

  async function loadRealBars(force){
    if(state.autoPreset!=='none')return D.fetchKlineHistory({market:state.market,symbol:state.symbol,interval:state.interval,maxBars:desiredBars()});
    return D.fetchKlines({market:state.market,symbol:state.symbol,interval:state.interval,force:!!force});
  }

  function visibleBars(rows){
    const range=state.chart&&state.chart.timeScale().getVisibleLogicalRange();
    if(!range||!rows.length)return rows;
    const from=Math.max(0,Math.floor(Number(range.from))),to=Math.min(rows.length-1,Math.ceil(Number(range.to)));
    return rows.slice(from,to+1);
  }
  function visibleContext(rows){
    const visible=visibleBars(rows),source=visible.length?visible:rows;
    let min=Infinity,max=-Infinity;for(const b of source){if(b.low<min)min=b.low;if(b.high>max)max=b.high;}
    return{currentPrice:rows[rows.length-1].close,visibleMin:min,visibleMax:max,tickSize:tickSize(),
      visibleStartTime:source[0]&&source[0].time,visibleEndTime:source[source.length-1]&&source[source.length-1].time};
  }

  async function buildAutoDocument(){
    const rules=await loadRules(),bars=state.data,last=bars[bars.length-1];if(!last)return null;
    const context=visibleContext(bars),input={preset:state.autoPreset,symbol:state.symbol,market:state.market,interval:state.interval,bars,context,config:rules};
    input.intervalSec=D.intervalSec(state.interval);
    if(state.autoPreset==='p1'){
      input.quarterStats=I.anchoredPeriodStats(bars,'quarter',D.intervalSec(state.interval));
      input.monthStats=I.anchoredPeriodStats(bars,'month',D.intervalSec(state.interval));
    }else if(state.autoPreset==='p2'||state.autoPreset==='p3'){
      const tpoBars=state.interval==='30m'?bars:await D.fetchKlineHistory({market:state.market,symbol:state.symbol,interval:'30m',maxBars:state.autoPreset==='p2'?5200:3600});
      input.tpoBars=tpoBars;
      const row=tickSize()*(Number(symbolMeta().tpoTicksPerRow)||100);
      input.tpoProfiles=I.tpoProfiles(tpoBars,{binSize:row,group:state.autoPreset==='p2'?'month':'week',minBins:rules.singlePrints.minBins,intervalSec:1800});
    }else if(state.autoPreset==='p4'){
      input.monthStats=I.anchoredPeriodStats(bars,'month',D.intervalSec(state.interval));
    }
    return A.buildPreset(input);
  }

  async function renderSelectedAnnotations(){
    state.annotations.setContext(annotationContext());
    if(state.fixture!=='none'){
      const doc=await AR.loadAnnotationFixture(state.fixture),stats=state.annotations.render(doc);state.annotationStats=stats;return{...stats,total:doc.items.length};
    }
    if(state.autoPreset!=='none'){
      const doc=await buildAutoDocument();const stats=state.annotations.render(doc);state.annotationStats=stats;return{...stats,total:doc.items.length};
    }
    state.annotations.clear();state.annotationStats={rendered:0,skipped:0,errors:[]};return{...state.annotationStats,total:0};
  }

  async function setLoadedRows(rows){
    state.data=rows.slice().sort((a,b)=>a.time-b.time);state.byTime=new Map(state.data.map(c=>[D.toDisplayTime(c.time),c]));
    const out=seriesData(state.data);state.candles.setData(out.candles);state.volume.setData(out.volumes);
    state.annotations.setContext(annotationContext());state.chart.timeScale().fitContent();updateCountdown();
    const stats=await renderSelectedAnnotations();updateWatermark();updateInfo(state.data[state.data.length-1]);return stats;
  }

  async function loadData(force){
    const token=++state.loadToken;setStatus(state.fixture!=='none'?'Loading sample data…':'Loading '+displayCode()+' '+state.interval+'…');
    try{
      let rows=state.fixture!=='none'?await D.loadFixtureCandles(state.fixture):await loadRealBars(force);
      if(token!==state.loadToken)return;
      let integrity=D.validateKlineContinuity(rows,state.interval);
      if(state.fixture==='none'&&!integrity.ok&&!force){rows=await loadRealBars(true);integrity=D.validateKlineContinuity(rows,state.interval);}
      const stats=await setLoadedRows(rows),first=rows[0],last=rows[rows.length-1];
      let base=state.fixture!=='none'
        ?'SAMPLE 样例数据，不是实时分析 · '+rows.length+' candles'
        :'Loaded '+rows.length+' candles · '+D.formatLocalDateTime(first.time,false)+' → '+D.formatLocalDateTime(last.time,false)+' JST';
      if(!integrity.ok)base+=' · DATA GAP '+integrity.gaps.length;
      if(stats.total)base+=' · annotations '+stats.rendered+'/'+stats.total;
      state.lastStatusBase=base;setStatus(base,!integrity.ok);
    }catch(error){console.error(error);setStatus('Unable to load chart data: '+error.message,true);}
  }

  async function refreshLatest(){
    if(state.fixture!=='none'||state.latestRefreshBusy||!state.data.length)return;
    state.latestRefreshBusy=true;
    try{
      const latest=await D.fetchLatest({market:state.market,symbol:state.symbol,interval:state.interval});
      const plan=R.planLatestUpdates(state.data,latest,D.intervalSec(state.interval));
      if(plan.reloadRequired){await loadData(true);return;}
      const result=R.applyLatestUpdates({existing:state.data,latest,intervalSec:D.intervalSec(state.interval),candleSeries:state.candles,volumeSeries:state.volume,volumeUp:T.volumeUp,volumeDown:T.volumeDown,timeTransform:D.toDisplayTime});
      for(const candle of latest){
        const index=state.data.findIndex(x=>x.time===candle.time);
        if(index>=0)state.data[index]=candle;else if(candle.time>state.data[state.data.length-1].time)state.data.push(candle);
        state.byTime.set(D.toDisplayTime(candle.time),candle);
      }
      state.data.sort((a,b)=>a.time-b.time);state.annotations.setContext(annotationContext());updateInfo(state.data[state.data.length-1]);updateCountdown();
      if(result.errors.length)console.warn('latest update errors',result.errors);
    }catch(error){console.warn('latest candle refresh failed',error);}
    finally{state.latestRefreshBusy=false;}
  }

  function syncFromControls(){
    state.symbol=$('symbol').value;state.market=$('market').value;state.interval=$('interval').value;state.candleStyle=$('candleStyle').value;
    state.fixture=$('fixture').value;state.autoPreset=$('autoPreset').value;state.annotationAutoscale=$('annotationAutoscale').checked;applyUiState();
  }

  function syncControlsFromQuery(){
    const q=new URLSearchParams(location.search),symbol=q.get('symbol'),market=q.get('market'),interval=q.get('interval'),fixture=q.get('fixture'),auto=q.get('auto');
    if(fixture&&PRESETS[fixture]){$('fixture').value=fixture;$('autoPreset').value='none';$('symbol').value=PRESETS[fixture].symbol;$('market').value=PRESETS[fixture].market;$('interval').value=PRESETS[fixture].interval;return;}
    if(symbol&&SYMBOLS[symbol])$('symbol').value=symbol;if(market==='um'||market==='spot')$('market').value=market;if(['15m','30m','1h','2h','4h','1d'].includes(interval))$('interval').value=interval;
    if(['p1','p2','p3','p4'].includes(auto)){
      $('autoPreset').value=auto;
      const preset=PRESETS[auto];if(preset){$('market').value=preset.market;$('interval').value=preset.interval;}
    }
  }

  function footerText(){return'Generated '+D.formatLocalDateTime(Math.floor(Date.now()/1000),false)+' JST · Data: '+(state.fixture!=='none'?'Static sample':'Binance')+' · order-flow-analysis';}

  async function exportCurrent(){
    const preset=$('exportSize').value,previous=$('exportBtn').textContent;$('exportBtn').disabled=true;$('exportBtn').textContent='Exporting…';
    try{updateInfo(state.data[state.data.length-1]);const result=await E.exportPng({chart:state.chart,container,preset,infoLines:[infoLine1.textContent,infoLine2.textContent],footer:footerText(),filenameBase:displayCode().replace('.','-')+'-'+state.interval+(state.autoPreset!=='none'?'-'+state.autoPreset:'')});setStatus('Exported '+result.filename+' · '+result.width+'×'+result.height+' px');}
    catch(error){console.error(error);setStatus('PNG export failed: '+error.message,true);}finally{$('exportBtn').disabled=false;$('exportBtn').textContent=previous;}
  }

  async function onSelectionChange(){if(state.fixture!=='none')$('fixture').value='none';syncFromControls();await loadData();}
  async function onFixtureChange(){
    const id=$('fixture').value;if(id!=='none'){$('autoPreset').value='none';const p=PRESETS[id];$('symbol').value=p.symbol;$('market').value=p.market;$('interval').value=p.interval;}
    syncFromControls();await loadData();
  }
  async function onAutoChange(){
    const id=$('autoPreset').value;if(id!=='none'){$('fixture').value='none';const p=PRESETS[id];$('market').value='um';$('interval').value=p.interval;}
    syncFromControls();await loadData(true);
  }

  async function init(){
    if(!L){setStatus('Lightweight Charts failed to load.',true);return;}
    syncControlsFromQuery();state.symbol=$('symbol').value;state.market=$('market').value;state.interval=$('interval').value;state.candleStyle=$('candleStyle').value;state.fixture=$('fixture').value;state.autoPreset=$('autoPreset').value;state.annotationAutoscale=$('annotationAutoscale').checked;
    createChart();applyUiState();
    $('symbol').addEventListener('change',onSelectionChange);$('market').addEventListener('change',onSelectionChange);$('interval').addEventListener('change',onSelectionChange);
    $('candleStyle').addEventListener('change',()=>{state.candleStyle=$('candleStyle').value;state.candles.applyOptions(candleOptions());});
    $('fixture').addEventListener('change',onFixtureChange);$('autoPreset').addEventListener('change',onAutoChange);
    $('annotationAutoscale').addEventListener('change',()=>{state.annotationAutoscale=$('annotationAutoscale').checked;state.annotations.setContext(annotationContext());});
    $('exportBtn').addEventListener('click',exportCurrent);footerLocal.textContent='Display time: JST · Asia/Tokyo';
    window.__orderFlowChartDebug={state,get chart(){return state.chart;},get annotations(){return state.annotations;},annotationStats:()=>state.annotationStats,annotationCoordinates:()=>state.annotations?state.annotations.debugCoordinates():[],annotationProfiles:()=>state.annotations?state.annotations.debugProfiles():[],refreshLatest,loadData,buildAutoDocument};
    await loadData();setInterval(updateCountdown,1000);setInterval(refreshLatest,15000);
  }
  init();
})();