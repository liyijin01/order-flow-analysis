(function(){
  'use strict';

  const L=window.LightweightCharts,D=window.OrderFlowAnalysisData,E=window.OrderFlowAnalysisEngine,I=window.OrderFlowIndicators,AP=window.OrderFlowAnnotationPrimitives,P=window.OrderFlowAnalysisPrimitive,X=window.OrderFlowAnalysisExport,R=window.OrderFlowBoardRuntime;
  const T=window.OrderFlowTemplates||{},Layers=window.OrderFlowLayers||{};
  const SYMBOLS=window.ORDER_FLOW_SYMBOLS||{};
  const WATERMARK_COLOR='rgba(196,140,60,.30)';
  const $=id=>document.getElementById(id);
  const state={
    symbol:'BTCUSDT',timeframe:'1h',template:null,viewMode:'quarter',snapshot:false,rules:null,bundle:null,chart:null,candles:null,volume:null,quarterBands:[],primitive:null,
    loadToken:0,refreshTimer:null,model:null,viewKey:null,lastDisplayCount:0,lastFullLoadAt:0,refreshWarning:null,
    inFlight:null,abortController:null,lastSuccessAt:0,defaultViewRange:null,resizeToken:0,resizeSettle:null,watermark:null,countdownTimer:null,crosshairTime:null,priceScaleMargins:null
  };

  function tfLabel(tf){return({'30m':'30分钟','1h':'1小时','4h':'4小时','1d':'1天','1M':'1月'})[tf]||tf;}
  function displayTfLabel(){return templateConfig().displayTimeframeLabel||tfLabel(state.timeframe);}
  function profileTemplate(){return templateConfig().hideCandles===true;}
  function symbolMeta(){return SYMBOLS[state.symbol]||{displayName:state.symbol,tickSize:'0.01',ladderBin:'0.1'};}
  function pricePrecision(){const s=String(symbolMeta().tickSize||'0.01'),i=s.indexOf('.');return i<0?0:s.length-i-1;}
  function templateConfig(){const all=state.rules&&state.rules.templates||{};return all[state.template]||all[(state.rules&&state.rules.display&&state.rules.display.defaultTemplate)]||{};}
  function layerEnabled(name){const layers=templateConfig().layers||{};return layers[name]!==false;}
  function dataNeeds(){
    const cfg=templateConfig(),required={};
    const add=items=>{
      for(const [interval,value] of Object.entries(items||{})){
        const bars=Math.ceil(Number(value));
        if(Number.isFinite(bars)&&bars>0)required[interval]=Math.max(required[interval]||0,bars);
      }
    };
    const timeframe=state.timeframe;
    add({[timeframe]:Number(cfg.history&&cfg.history[timeframe])||D.displayCounts[timeframe]||500});
    add(cfg.history);
    const ctx={state,D,layerEnabled,templateConfig};
    for(const layer of Object.values(Layers)){
      if(layer&&typeof layer.needs==='function')add(layer.needs(ctx));
    }
    const handler=T[state.template];
    if(handler&&typeof handler.needs==='function')add(handler.needs(ctx));
    return{requiredIntervals:required};
  }

  function windowSpec(){
    const cfg=templateConfig(),raw=cfg.window||{mode:'view'},spec=(raw&&raw[state.timeframe])||raw||{};
    const mode=spec.mode==='view'?state.viewMode:(spec.mode||'quarter');
    return{...spec,mode};
  }
  function marginBars(contentBars,pct){const p=Math.max(0,Math.min(80,Number(pct)||0));return p>0?Math.ceil(Math.max(1,contentBars)*p/(100-p)):0;}
  function applyTemplateChrome(){
    const cfg=templateConfig(),legend=$('analysisLegend'),table=document.querySelector('.table-wrap');
    if(legend)legend.style.display=cfg.legend===false?'none':'';
    if(table)table.style.display=cfg.table===false?'none':'';
    const tfText={'30m':'30m','4h':'4h','1h':'1h','1d':'1D','1M':'1M'};
    document.querySelectorAll('[data-tf]').forEach(b=>{const allowed=(cfg.timeframes||[]).includes(b.dataset.tf);b.style.display=allowed?'':'none';b.disabled=!allowed;b.textContent=profileTemplate()&&b.dataset.tf==='1d'?'M30':(tfText[b.dataset.tf]||b.dataset.tf);});
    const meta=document.querySelector('.capture-meta');if(meta)meta.textContent=String(cfg.label||state.template).toUpperCase();
  }
  function syncVolumeLayer(){
    if(!state.chart)return;
    if(layerEnabled('volume')){
      if(!state.volume)state.volume=state.chart.addSeries(L.HistogramSeries,{priceFormat:{type:'volume'},priceLineVisible:false,lastValueVisible:false},1);
      const panes=state.chart.panes();if(state.volume&&panes[1])panes[1].setHeight(Math.max(105,Math.round($('analysisChart').clientHeight*.18)));
    }else if(state.volume){state.chart.removeSeries(state.volume);state.volume=null;}
  }
  function fmtPrice(v){
    const p=pricePrecision(),tick=Number(symbolMeta().tickSize)||.01,n=E.roundToTick(Number(v),tick);
    return n.toLocaleString(undefined,{minimumFractionDigits:p,maximumFractionDigits:p});
  }
  const Ui=window.OrderFlowAnalysisUi;
  const formatJstClock=Ui.formatJstClock,formatCutoffJst=Ui.formatCutoffJst,formatRemaining=Ui.formatRemaining;
  const legendEntries=()=>Ui.legendEntries(state.rules);
  const renderLegend=()=>Ui.renderLegend($('analysisLegend'),state.rules);
  const rangesClose=R.rangesClose;
  function colorAlpha(color,alpha){
    const a=Math.max(0,Math.min(1,Number(alpha)));
    const s=String(color||'');
    if(/^rgba\(/i.test(s))return s.replace(/,[^,]+\)$/g,','+a+')');
    const rgb=s.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
    if(rgb)return'rgba('+rgb[1]+','+rgb[2]+','+rgb[3]+','+a+')';
    const hex=s.match(/^#([0-9a-f]{6})$/i);
    if(hex){const n=parseInt(hex[1],16);return'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+a+')';}
    return s;
  }
  async function loadRules(){
    if(state.rules)return state.rules;
    const r=await fetch('config/analysis-rules.json',{cache:'no-store'});if(!r.ok)throw new Error('analysis-rules HTTP '+r.status);
    state.rules=await r.json();return state.rules;
  }

  function createChart(){
    const container=$('analysisChart');
    const chart=L.createChart(container,{
      width:container.clientWidth,height:container.clientHeight,
      layout:{background:{type:'solid',color:'#1b2130'},textColor:'#aeb7c8',attributionLogo:true,panes:{separatorColor:'rgba(255,255,255,.10)',separatorHoverColor:'rgba(255,255,255,.22)',enableResize:true}},
      grid:{vertLines:{color:'rgba(255,255,255,.055)'},horzLines:{color:'rgba(255,255,255,.055)'}},
      rightPriceScale:{borderColor:'rgba(255,255,255,.14)'},
      timeScale:{borderColor:'rgba(255,255,255,.14)',timeVisible:true,secondsVisible:false,rightOffset:30,tickMarkFormatter:(time,type,locale)=>D.formatDisplayTick(time,type,locale)},
      localization:{locale:'ja-JP',timeFormatter:(time)=>D.formatDisplayTime(time)},
      crosshair:{mode:L.CrosshairMode.Normal}
    });
    const tick=Number(symbolMeta().tickSize)||.01;
    const candles=chart.addSeries(L.CandlestickSeries,{
      upColor:'#e6e9ef',downColor:'rgba(0,0,0,0)',borderUpColor:'#e6e9ef',borderDownColor:'#e6e9ef',wickUpColor:'#e6e9ef',wickDownColor:'#e6e9ef',
      priceFormat:{type:'price',precision:pricePrecision(),minMove:tick},lastValueVisible:true,priceLineVisible:false
    },0);
    const primitive=new P.AnalysisBoardPrimitive({});
    candles.attachPrimitive(primitive);
    state.chart=chart;state.candles=candles;state.volume=null;state.primitive=primitive;
    state.priceScaleMargins={...(candles.priceScale().options().scaleMargins||{})};syncVolumeLayer();
    state.watermark=L.createTextWatermark(chart.panes()[0],{horzAlign:'center',vertAlign:'center',lines:[{text:symbolMeta().displayName+', '+tfLabel(state.timeframe),color:WATERMARK_COLOR,fontSize:44,fontStyle:'bold'}]});
    for(let i=0;i<2;i++){const b=new AP.band({id:'quarter-band-'+i,type:'band',points:[],label:'',color:state.rules.colors.vwap,fill:state.rules.colors.quarterBandFill});b.autoscaleInfo=()=>{const m=state.model;if(!m||!b.item.points||!b.item.points.length)return null;const span=Math.max(1e-12,Number(m.viewMax)-Number(m.viewMin)),pad=span*Number(state.rules.valueAreas.visiblePadPct||0)/100,lo=Number(m.viewMin)-pad,hi=Number(m.viewMax)+pad;let mn=Infinity,mx=-Infinity;for(const p of b.item.points)for(const v of p.slice(1)){const n=Math.max(lo,Math.min(hi,Number(v)));if(Number.isFinite(n)){mn=Math.min(mn,n);mx=Math.max(mx,n);}}return Number.isFinite(mn)&&Number.isFinite(mx)?{priceRange:{minValue:mn,maxValue:mx}}:null;};candles.attachPrimitive(b);state.quarterBands.push(b);}
    new ResizeObserver(()=>{
      const before=chart.timeScale().getVisibleLogicalRange();
      const wasDefault=rangesClose(before,state.defaultViewRange,.5);
      chart.resize(container.clientWidth,container.clientHeight);
      const ps=chart.panes();if(state.volume&&ps[1])ps[1].setHeight(Math.max(100,Math.round(container.clientHeight*.18)));
      scheduleResizeSettle(wasDefault,before);
      if(primitive.requestUpdate)primitive.requestUpdate();
    }).observe(container);
  }

  function extrema(bars){
    let min=Infinity,max=-Infinity;
    for(const b of bars||[]){if(Number(b.low)<min)min=Number(b.low);if(Number(b.high)>max)max=Number(b.high);}
    return{min,max,span:Math.max(1e-12,max-min)};
  }


  const MONTH_SHORT=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function monthLabelFromStart(start,currentYear){
    const d=new Date(Number(start)*1000),base=MONTH_SHORT[d.getUTCMonth()];
    return(d.getUTCFullYear()===Number(currentYear)-1?'PY ':'')+base;
  }
  function nextMonthStartSec(time){
    const d=new Date(Number(time)*1000);return Date.UTC(d.getUTCFullYear()+(d.getUTCMonth()===11?1:0),(d.getUTCMonth()+1)%12,1)/1000;
  }
  function normalizeTpoPeriod(row){
    return{...row,startSec:Date.parse(String(row.start||''))/1000,endSec:Date.parse(String(row.end||''))/1000,
      rows:(row.rows||[]).map(r=>[Number(r[0]),Number(r[1])]),rowSize:Number(row.rowSize),poc:Number(row.poc),vah:Number(row.vah),val:Number(row.val),high:Number(row.high),low:Number(row.low)};
  }
  function weekLabel(start){
    const d=new Date(Number(start)*1000),mon=MONTH_SHORT[d.getUTCMonth()],first=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1));
    const firstMonday=1+((8-first.getUTCDay())%7),week=Math.floor((d.getUTCDate()-firstMonday)/7)+1;
    return mon+' W'+Math.max(1,week);
  }
  function buildAnalysis(bundle){
    const handler=T[state.template];
    const ctx={
      state,E,I,D,bundle,Layers,templates:T,symbolMeta,templateConfig,layerEnabled,windowSpec,defaultWindow,
      profileTemplate,extrema,colorAlpha,monthLabelFromStart,nextMonthStartSec,normalizeTpoPeriod,
      weekLabel,fmtPrice,documentRoot:$,compose:Layers.compose
    };
    if(handler&&handler.modelBuilder&&typeof handler.build==='function')return handler.build(ctx);
    return Layers.compose.build(ctx);
  }

  function renderTable(model){
    const tbody=$('regionRows');tbody.textContent='';
    for(const r of model.tableRows){
      const tr=document.createElement('tr');
      const range=r.missing||r.summary?'—':(r.low===r.high?fmtPrice(r.low):fmtPrice(r.low)+' – '+fmtPrice(r.high));
      const dist=r.distance==null?'—':r.distance.toFixed(2)+'%';
      const values=[r.type,range,dist,r.status,r.period,r.source||'—'];
      for(let i=0;i<values.length;i++){
        const td=document.createElement('td');td.textContent=values[i];
        if(r.summary&&i===0){td.style.whiteSpace='normal';td.style.overflowWrap='anywhere';}
        tr.appendChild(td);
      }
      if(r.missing)tr.classList.add('missing');tbody.appendChild(tr);
    }
  }

  function defaultWindow(count){
    const win=windowSpec(),cfg=templateConfig(),marginPct=Number(cfg.rightMarginPct);
    if(Number.isFinite(marginPct)&&marginPct>0){
      const visible=win.mode==='quarter'?count:Math.min(count,Number(win.visibleBars)||count);
      const right=cfg.proportionalRightMargin===true&&visible>1
        ?(visible-1)*(marginPct/100)/(1-marginPct/100)
        :marginBars(visible,marginPct);
      const from=Math.max(0,count-visible);
      return{visible,rightOffsetBars:right,range:{from,to:Math.max(0,count-1)+right}};
    }
    if(win.mode==='quarter'){const right=Math.ceil(Math.max(1,count)*Number(state.rules.display.quarterRightPct||.04));return{visible:count,rightOffsetBars:right,range:{from:0,to:Math.max(0,count-1)+right}};}
    return R.defaultWindow(state.chart,state.rules,state.timeframe,count);
  }

  function defaultVisibleRange(count){return defaultWindow(count).range;}

  function applyDefaultView(count){
    const win=windowSpec(),cfg=templateConfig(),spec=defaultWindow(count),customMargin=Number(cfg.rightMarginPct)>0;
    if(win.mode==='quarter'||customMargin){
      state.chart.timeScale().applyOptions({rightOffset:spec.rightOffsetBars,minBarSpacing:(win.mode==='quarter'||customMargin)?Number(state.rules.display.quarterMinBarSpacing||.05):Number(state.rules.display.minBarSpacingPx||5)});
      state.chart.timeScale().setVisibleLogicalRange(spec.range);state.defaultViewRange={...spec.range};return spec;
    }
    state.chart.timeScale().applyOptions({minBarSpacing:Number(state.rules.display.minBarSpacingPx||5)});return R.applyDefaultView(state.chart,state.rules,state.timeframe,count,state);
  }

  const nextFrame=R.nextFrame;

  async function settleDefaultWindow(bundle,shouldContinue){
    if(!state.model||!bundle)return state.model;
    let model=state.model,stable=0,lastWidth=-1;
    for(let i=0;i<10&&stable<3;i++){
      await nextFrame();
      if(shouldContinue&&!shouldContinue())return model;
      const width=Number(state.chart.timeScale().width());
      const spec=defaultWindow(model.display.length);
      if(spec.visible!==model.visibleBars){
        model=buildAnalysis(bundle);state.model=model;
        applySeries(model);renderTable(model);
        applyDefaultView(model.display.length);
        stable=0;lastWidth=-1;continue;
      }
      if(Math.abs(width-lastWidth)<.5)stable++;
      else stable=0;
      lastWidth=width;
    }
    return model;
  }

  function scheduleResizeSettle(wasDefault,beforeRange){
    if(!state.model||!state.bundle)return;
    R.scheduleResize(state,wasDefault,beforeRange,state.chart,shouldContinue=>settleDefaultWindow(state.bundle,shouldContinue));
  }

  function resetView(){
    if(!state.model)return;
    R.resetView([state.candles,state.volume].filter(Boolean),state.chart,null);
    applyDefaultView(state.model.display.length);
  }

  function applySeries(model){
    syncVolumeLayer();
    const key=state.symbol+'|'+state.timeframe+'|'+state.template+'|'+state.viewMode,sameView=state.viewKey===key;
    const oldRange=sameView?state.chart.timeScale().getVisibleLogicalRange():null;
    const oldWasDefault=sameView&&rangesClose(oldRange,state.defaultViewRange,.5);
    const oldCount=state.lastDisplayCount||0;
    const followedRight=!!(oldRange&&Number(oldRange.to)>=oldCount-1);
    if(!sameView){
      state.candles.priceScale().applyOptions({autoScale:true});
      if(state.volume)state.volume.priceScale().applyOptions({autoScale:true});
      const tick=Number(symbolMeta().tickSize)||.01;
      const fmt={type:'price',precision:pricePrecision(),minMove:tick};
      state.candles.applyOptions({priceFormat:fmt});
    }
    const hidden=profileTemplate();
    state.candles.priceScale().applyOptions({scaleMargins:hidden?{top:0,bottom:0}:(state.priceScaleMargins||{})});
    state.candles.applyOptions(hidden
      ?{upColor:'rgba(0,0,0,0)',downColor:'rgba(0,0,0,0)',borderUpColor:'rgba(0,0,0,0)',borderDownColor:'rgba(0,0,0,0)',wickUpColor:'rgba(0,0,0,0)',wickDownColor:'rgba(0,0,0,0)',lastValueVisible:true,priceLineVisible:true,priceLineStyle:L.LineStyle.Dashed}
      :{upColor:'#e6e9ef',downColor:'rgba(0,0,0,0)',borderUpColor:'#e6e9ef',borderDownColor:'#e6e9ef',wickUpColor:'#e6e9ef',wickDownColor:'#e6e9ef',lastValueVisible:true,priceLineVisible:false});
    const window=hidden&&model.profileWindow,clampPrice=v=>window?Math.max(Number(window.min),Math.min(Number(window.max),Number(v))):Number(v);
    const candleData=model.display.map(b=>({time:D.toDisplayTime(b.time),open:clampPrice(b.open),high:clampPrice(b.high),low:clampPrice(b.low),close:clampPrice(b.close)}));
    const volumeData=model.display.map(b=>({time:D.toDisplayTime(b.time),value:b.volume,color:b.close>=b.open?'rgba(230,234,242,.42)':'rgba(230,234,242,.68)'}));
    state.candles.setData(candleData);if(state.volume)state.volume.setData(volumeData);
    for(let i=0;i<state.quarterBands.length;i++){const seg=layerEnabled('quarterBands')?model.quarterVwaps[i]:null,b=state.quarterBands[i];b.item={id:'quarter-band-'+i,type:'band',points:seg?seg.points.map(p=>[p.time,p.vwap,p.upper,p.lower]):[],label:'',color:state.rules.colors.vwap,fill:state.rules.colors.quarterBandFill};b.setContext({bars:model.display,intervalSec:D.intervalSec(state.timeframe),timeOffsetSec:9*3600,autoscale:true,priceFormatter:fmtPrice});if(b.requestUpdate)b.requestUpdate();}
    const autoscaleSpan=Math.max(1e-12,Number(model.viewMax)-Number(model.viewMin));
    const autoscalePad=hidden?0:autoscaleSpan*Number(state.rules.valueAreas.visiblePadPct||0)/100;
    state.primitive.setModel({
      profiles:model.profiles||[],regions:model.regions,levels:model.levels,curves:model.curves||[],bars:model.display,currentPrice:model.current,
      autoscaleMin:Number(model.viewMin)-autoscalePad,autoscaleMax:Number(model.viewMax)+autoscalePad,forceAutoscaleRange:hidden&&!!model.profileWindow,
      intervalSec:D.intervalSec(state.timeframe),timeOffsetSec:9*3600,axisMinGap:state.rules.axisLabels.minGapPx,
      textMinGap:state.rules.textLabels.minGapPx,textMaxShift:state.rules.textLabels.maxShiftPx,priceFormatter:fmtPrice
    });
    const newCount=model.display.length;
    if(!sameView||!oldRange){
      applyDefaultView(newCount);
    }else if(followedRight){
      const delta=newCount-oldCount,next={from:Number(oldRange.from)+delta,to:Number(oldRange.to)+delta};
      state.chart.timeScale().setVisibleLogicalRange(next);
      if(oldWasDefault)state.defaultViewRange={from:next.from,to:next.to};
    }else{
      state.chart.timeScale().setVisibleLogicalRange(oldRange);
      if(oldWasDefault)state.defaultViewRange={from:Number(oldRange.from),to:Number(oldRange.to)};
    }
    state.viewKey=key;state.lastDisplayCount=newCount;
    const panes=state.chart.panes();if(panes[1])panes[1].setHeight(Math.max(105,Math.round($('analysisChart').clientHeight*.18)));
    updateChartInfo(model,state.crosshairTime);updateCountdown();
  }

  function formatVolume(v){const n=Math.abs(Number(v)||0);if(n>=1e9)return(n/1e9).toFixed(2)+'B';if(n>=1e6)return(n/1e6).toFixed(2)+'M';if(n>=1e3)return(n/1e3).toFixed(1)+'K';return n.toFixed(2);}
  function updateChartInfo(model,time){
    if(!model)return;const target=Number.isFinite(Number(time))?Number(time):Number(model.last.time);
    const bar=model.display.find(b=>Number(b.time)===target)||model.last,chg=Number(bar.close)-Number(bar.open),pct=Number(bar.open)?chg/Number(bar.open)*100:0,cls=chg>=0?'up':'down';
    const line1=$('chartInfo1');line1.textContent='';
    const a=document.createElement('span');a.className='muted';a.textContent=symbolMeta().displayName+' · '+displayTfLabel()+' · Binance  开='+fmtPrice(bar.open)+' 高='+fmtPrice(bar.high)+' 低='+fmtPrice(bar.low)+' 收='+fmtPrice(bar.close)+' ';line1.appendChild(a);
    const b=document.createElement('span');b.className=cls;b.textContent='涨跌 '+(chg>=0?'+':'')+fmtPrice(chg)+' ('+(pct>=0?'+':'')+pct.toFixed(2)+'%)';line1.appendChild(b);
    const c=document.createElement('span');c.className='muted';c.textContent=' 量 '+formatVolume(bar.volume);line1.appendChild(c);
    const line2=$('chartInfo2');line2.textContent='';
    const add=(text,klass)=>{const e=document.createElement('span');e.className=klass;e.textContent=text;line2.appendChild(e);};
    const handler=T[state.template];
    if(handler&&typeof handler.infoLine==='function'){
      handler.infoLine({state,model,line2,fmtPrice,weekLabel,monthLabelFromStart},bar,add);
    }
  }
  function updateCountdown(){
    const el=$('closeCountdown');el.style.display='none';el.textContent='';
    if(state.snapshot||profileTemplate()||!state.model){if(state.primitive)state.primitive.setCountdown(null);return;}
    const bar=state.model.last,closeMs=Number(bar.closeTime),left=closeMs-Date.now();
    if(!Number.isFinite(closeMs)||left<0){if(state.primitive)state.primitive.setCountdown(null);return;}
    if(state.primitive)state.primitive.setCountdown({text:formatRemaining(left),offsetPx:Number(state.rules.axisLabels.minGapPx)||18,color:'#e6e9ef',textColor:'#111827'});
  }

  function updateSelectionState(){
    $('boardTitle').textContent=symbolMeta().displayName+' · '+displayTfLabel();
    document.querySelectorAll('[data-symbol]').forEach(b=>b.classList.toggle('active',b.dataset.symbol===state.symbol));
    document.querySelectorAll('[data-tf]').forEach(b=>b.classList.toggle('active',b.dataset.tf===state.timeframe));
    document.querySelectorAll('[data-tpl]').forEach(b=>b.classList.toggle('active',b.dataset.tpl===state.template));
    applyTemplateChrome();
    if(state.watermark)state.watermark.applyOptions({lines:[{text:symbolMeta().displayName+', '+displayTfLabel(),color:WATERMARK_COLOR,fontSize:44,fontStyle:'bold'}]});
  }

  function updateStaleDataWarning(){
    const el=$('staleData');if(!el)return;
    el.textContent='';el.style.display='none';
    if(state.snapshot||!state.bundle)return;
    const raw=[state.bundle.keyLevels&&state.bundle.keyLevels.generatedAt,state.bundle.tpo&&state.bundle.tpo.generatedAt];
    let oldest=Infinity;
    for(const value of raw){const ms=Date.parse(String(value||''));if(Number.isFinite(ms)&&ms<oldest)oldest=ms;}
    if(!Number.isFinite(oldest))return;
    const hours=Math.floor(Math.max(0,Date.now()-oldest)/3600000);
    if(hours>36){el.textContent='预计算数据已 '+hours+' 小时未更新';el.style.display='';}
  }

  function updateHeader(model){
    updateSelectionState();updateStaleDataWarning();
    if(state.snapshot){
      $('infoLine').textContent=symbolMeta().displayName+' · '+displayTfLabel()+' · 收 '+fmtPrice(model.current)+' · 数据截至 '+formatCutoffJst(model.cutoffUtc);
      $('cutoff').textContent='数据截至 '+formatCutoffJst(model.cutoffUtc)+' JST';
    }else{
      $('infoLine').textContent=symbolMeta().displayName+' · '+displayTfLabel()+' · 收 '+fmtPrice(model.current)+' · 最后刷新 '+formatJstClock(state.lastSuccessAt)+' JST';
      $('cutoff').textContent='实时 Binance USD-M · 每 '+String(Number(state.rules.display.refreshSeconds)||60)+' 秒刷新';
    }
    const errs=Object.keys(model.bundleErrors||{});
    if(state.refreshWarning){
      $('status').textContent='刷新失败，显示 '+D.formatJst(model.last.time).slice(-5)+' 的数据 · '+state.refreshWarning;
      $('status').classList.add('error');
    }else{
      $('status').textContent='Loaded '+model.display.length+' display candles · '+model.regions.length+' drawn regions · '+model.levels.length+' drawn key lines'+(errs.length?' · 缺失 '+errs.join(', '):'');
      $('status').classList.toggle('error',errs.length>0);
    }
  }

  async function getBundle(token,forceFull,signal){
    const progress=$('status');
    if(state.snapshot){
      progress.textContent='Loading archived snapshot…';
      return{bundle:await D.loadSnapshot(state.symbol),full:true,failures:[]};
    }
    const full=forceFull||!state.bundle||state.bundle.symbol!==state.symbol||(Date.now()-state.lastFullLoadAt)>=30*60*1000;
    if(full){
      const bundle=await D.loadLive(state.symbol,state.timeframe,p=>{
        if(token===state.loadToken)progress.textContent='Loading '+p.done+'/'+p.total+' · '+p.label;
      },signal,dataNeeds());
      state.lastFullLoadAt=Date.now();
      return{bundle,full:true,failures:[]};
    }
    const inc=await D.refreshLiveBundle(state.bundle,state.symbol,state.timeframe,signal,dataNeeds());
    return{bundle:inc.bundle,full:false,failures:inc.failures||[]};
  }

  async function refresh(forceFull,options){
    return R.runRefresh(state,forceFull,options,{
      before:()=>loadRules(),
      load:(token,full,signal)=>getBundle(token,full,signal),
      apply:async(result)=>{
        state.bundle=result.bundle;
        state.refreshWarning=result.failures.length?result.failures.map(x=>x.interval).join(', ')+' 更新失败':null;
        let model=buildAnalysis(result.bundle);state.model=model;
        applySeries(model);renderTable(model);
        model=await settleDefaultWindow(result.bundle);
        state.lastSuccessAt=Date.now();
        updateHeader(model);
        return model;
      },
      error:(e)=>{
        console.error(e);
        if(state.model){
          state.refreshWarning=String(e.message||e);
          updateHeader(state.model);
        }else{
          $('status').textContent='加载失败：'+String(e.message||e);$('status').classList.add('error');
        }
        return null;
      }
    });
  }

  function setSelection(symbol,tf){
    if(symbol&&SYMBOLS[symbol])state.symbol=symbol;
    if(['30m','4h','1h','1d','1M'].includes(tf))state.timeframe=tf;
    state.bundle=null;state.lastFullLoadAt=0;state.refreshWarning=null;
    updateSelectionState();
    $('infoLine').textContent=symbolMeta().displayName+' · '+tfLabel(state.timeframe)+' · 加载中…';
    $('status').textContent='Loading…';$('status').classList.remove('error');
    const q=new URLSearchParams(location.search);q.set('symbol',state.symbol);q.set('tf',state.timeframe);q.set('tpl',state.template);if(templateConfig().keepsViewParam===true)q.set('view',state.viewMode);else q.delete('view');if(state.snapshot)q.set('snapshot','1');
    history.replaceState(null,'',location.pathname+'?'+q.toString());refresh(true,{cancelPrevious:true});
  }

  function setTemplate(template){
    const all=state.rules&&state.rules.templates||{};if(!all[template]||template===state.template)return;
    state.template=template;state.viewMode='quarter';
    const cfg=templateConfig();if(!(cfg.timeframes||[]).includes(state.timeframe))state.timeframe=cfg.defaultTimeframe||(cfg.timeframes||[])[0]||state.timeframe;
    state.viewKey=null;state.defaultViewRange=null;state.bundle=null;state.lastFullLoadAt=0;state.refreshWarning=null;updateSelectionState();syncVolumeLayer();
    const q=new URLSearchParams(location.search);q.set('symbol',state.symbol);q.set('tf',state.timeframe);q.set('tpl',state.template);if(templateConfig().keepsViewParam===true)q.set('view',state.viewMode);else q.delete('view');if(state.snapshot)q.set('snapshot','1');
    history.replaceState(null,'',location.pathname+'?'+q.toString());refresh(true,{cancelPrevious:true});
  }

  async function downloadPng(){
    if(!state.model)return;
    $('downloadBtn').disabled=true;
    try{
      const cfg=templateConfig();
      await X.exportBoard({
        chart:state.chart,model:state.model,info:$('infoLine').textContent,rows:state.model.tableRows,
        filename:state.symbol+(cfg.fileSuffix===false?'':'-'+state.template)+'-'+state.timeframe+'.png',priceFormatter:fmtPrice,
        legend:cfg.legend===false?[]:legendEntries(),legendEnabled:cfg.legend!==false,tableEnabled:cfg.table!==false,
        footer:$('cutoff').textContent,overlayLines:[$('chartInfo1').textContent,$('chartInfo2').textContent]
      });
    }finally{$('downloadBtn').disabled=false;}
  }

  function debugView(){
    const range=state.chart&&state.chart.timeScale().getVisibleLogicalRange();
    return{
      range,logicalSlots:range?Number(range.to)-Number(range.from):null,
      visibleBars:state.model&&state.model.visibleBars,
      viewMin:state.model&&state.model.viewMin,viewMax:state.model&&state.model.viewMax
    };
  }

  async function init(){
    const q=new URLSearchParams(location.search);
    state.symbol=SYMBOLS[q.get('symbol')]?q.get('symbol'):'BTCUSDT';
    state.viewMode=['quarter','recent'].includes(q.get('view'))?q.get('view'):'quarter';

    state.snapshot=q.get('snapshot')==='1';
    if(state.snapshot)document.body.classList.add('snapshot');
    await loadRules();
    const ids=Object.keys(state.rules.templates||{}),defaultTemplate=state.rules.display.defaultTemplate||ids[0];
    const recentTemplate=state.rules.display.recentViewTemplate||defaultTemplate;
    state.template=ids.includes(q.get('tpl'))?q.get('tpl'):(q.get('view')==='recent'?recentTemplate:defaultTemplate);
    const cfg=templateConfig(),requestedTf=['30m','4h','1h','1d','1M'].includes(q.get('tf'))?q.get('tf'):null;
    state.timeframe=requestedTf&&(cfg.timeframes||[]).includes(requestedTf)?requestedTf:(cfg.defaultTimeframe||(cfg.timeframes||[])[0]||'1h');
    renderLegend();createChart();applyTemplateChrome();
    document.querySelectorAll('[data-symbol]').forEach(b=>b.addEventListener('click',()=>setSelection(b.dataset.symbol,state.timeframe)));
    document.querySelectorAll('[data-tf]').forEach(b=>b.addEventListener('click',()=>setSelection(state.symbol,b.dataset.tf)));
    document.querySelectorAll('[data-tpl]').forEach(b=>b.addEventListener('click',()=>setTemplate(b.dataset.tpl)));
    $('resetViewBtn').addEventListener('click',resetView);
    $('downloadBtn').addEventListener('click',downloadPng);
    state.chart.subscribeCrosshairMove(param=>{const t=param&&param.time!=null?Number(param.time)-9*3600:null;state.crosshairTime=Number.isFinite(t)?t:null;updateChartInfo(state.model,state.crosshairTime);});
    window.__analysisDebug={
      state,get model(){return state.model;},refresh:(forceFull)=>refresh(!!forceFull),
      axisLabels:()=>state.primitive?state.primitive.debugAxisLabels():[],
      profiles:()=>state.primitive?state.primitive.debugProfiles():[],
      priceCoordinate:p=>state.candles?state.candles.priceToCoordinate(Number(p)):null,
      volumeFormat:()=>state.volume?state.volume.options().priceFormat:null,
      layerEnabled:name=>layerEnabled(name),
      view:debugView,
      mainPaneHeight:()=>{const p=state.chart&&state.chart.panes&&state.chart.panes()[0];return p&&typeof p.getHeight==='function'?p.getHeight():Math.round($('analysisChart').clientHeight*.82);},
      candleTimes:()=>state.model?state.model.display.map(x=>x.time):[],
      vwapTimes:()=>state.model?state.model.currentVwap.map(x=>x.time):[],
      viewMode:()=>state.viewMode,
      template:()=>state.template,
      windowSpec:()=>windowSpec(),
      legend:()=>legendEntries(),
      candleStyle:()=>state.candles?state.candles.options():null,
      chartInfo:()=>({line1:$('chartInfo1').textContent,line2:$('chartInfo2').textContent,countdown:state.primitive&&state.primitive.model&&state.primitive.model.countdown?state.primitive.model.countdown.text:'',watermark:symbolMeta().displayName+', '+displayTfLabel(),watermarkColor:WATERMARK_COLOR})
    };
    await refresh(true);
    if(!state.snapshot){
      state.countdownTimer=setInterval(updateCountdown,1000);updateCountdown();
      const refreshMs=Number(state.rules.display.refreshSeconds||60)*1000;
      R.startRefreshLoop(state,refreshMs,refresh);
    }
  }
  init();
})();
