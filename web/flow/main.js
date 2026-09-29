(function(){
  'use strict';
  const L=window.LightweightCharts,D=window.OrderFlowAnalysisData,E=window.OrderFlowAnalysisEngine,I=window.OrderFlowIndicators,
    F=window.OrderFlowFlowEngine,FD=window.OrderFlowFlowData,R=window.OrderFlowBoardRuntime,X=window.OrderFlowAnalysisExport;
  const SYMBOLS=window.ORDER_FLOW_SYMBOLS||{},P=window.OrderFlowAnnotationPrimitives;
  const $=id=>document.getElementById(id);
  const state={
    symbol:'BTCUSDT',timeframe:'15m',anchorMode:'swing',manualAnchorIso:null,snapshot:false,rules:null,bundle:null,model:null,
    chart:null,candles:null,band:null,anchorLine:null,s2u:null,s2l:null,perpCvd:null,perpLive:null,spotCvd:null,spotLive:null,
    depthBid:null,depthAsk:null,depthDelta:[],depthCutoff:[],loadToken:0,inFlight:null,abortController:null,refreshTimer:null,
    lastSuccessAt:0,lastFullLoadAt:0,refreshWarning:null,viewKey:null,lastDisplayCount:0,defaultViewRange:null,resizeToken:0,resizeSettle:null
  };

  function meta(){return SYMBOLS[state.symbol]||{displayName:state.symbol,tickSize:'0.01'};}
  function tfLabel(){return state.timeframe==='15m'?'15分钟':'30分钟';}
  function precision(){const s=String(meta().tickSize||'.01'),i=s.indexOf('.');return i<0?0:s.length-i-1;}
  function fmtPrice(v){return Number(v).toLocaleString(undefined,{minimumFractionDigits:precision(),maximumFractionDigits:precision()});}
  function fmtIsoJst(iso){const ms=Date.parse(String(iso||''));return Number.isFinite(ms)?D.formatJst(ms/1000):'—';}
  function manualMs(){const ms=Date.parse(String(state.manualAnchorIso||''));return Number.isFinite(ms)?ms:null;}

  async function loadRules(){
    if(state.rules)return state.rules;
    const r=await fetch('config/flow-rules.json',{cache:'no-store'});if(!r.ok)throw new Error('flow-rules HTTP '+r.status);
    state.rules=await r.json();return state.rules;
  }

  function createLine(color,pane,width,autoscale){
    const options={color,lineWidth:width||1.5,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false};
    if(autoscale===false)options.autoscaleInfoProvider=()=>null;
    return state.chart.addSeries(L.LineSeries,options,pane);
  }
  function createChart(){
    const container=$('flowChart');
    const chart=L.createChart(container,{
      width:container.clientWidth,height:container.clientHeight,
      layout:{background:{type:'solid',color:'#1b2130'},textColor:'#aeb7c8',attributionLogo:true,panes:{separatorColor:'rgba(255,255,255,.10)',separatorHoverColor:'rgba(255,255,255,.22)',enableResize:true}},
      grid:{vertLines:{color:'rgba(255,255,255,.045)'},horzLines:{color:'rgba(255,255,255,.045)'}},
      rightPriceScale:{borderColor:'rgba(255,255,255,.14)'},
      timeScale:{borderColor:'rgba(255,255,255,.14)',timeVisible:true,secondsVisible:false,rightOffset:Number(state.rules.display.rightOffset)||24,tickMarkFormatter:(t,k,l)=>D.formatDisplayTick(t,k,l)},
      localization:{locale:'ja-JP',timeFormatter:t=>D.formatDisplayTime(t)},crosshair:{mode:L.CrosshairMode.Normal}
    });
    state.chart=chart;
    const tick=Number(meta().tickSize)||.01;
    state.candles=chart.addSeries(L.CandlestickSeries,{
      upColor:'rgba(0,0,0,0)',downColor:'#d9dde6',borderUpColor:'#d9dde6',borderDownColor:'#d9dde6',wickUpColor:'#d9dde6',wickDownColor:'#d9dde6',
      priceFormat:{type:'price',precision:precision(),minMove:tick},lastValueVisible:true,priceLineVisible:false
    },0);
    state.s2u=createLine(state.rules.colors.sigma2,0,1,false);state.s2l=createLine(state.rules.colors.sigma2,0,1,false);
    state.perpCvd=createLine(state.rules.colors.perpCvd,1,1.6);state.perpLive=createLine(state.rules.colors.live,1,2.8);
    state.spotCvd=createLine(state.rules.colors.spotCvd,2,1.6);state.spotLive=createLine(state.rules.colors.live,2,2.8);
    state.depthBid=createLine(state.rules.colors.bid,3,1.2);state.depthAsk=createLine(state.rules.colors.ask,3,1.2);
    state.depthDelta=[
      chart.addSeries(L.HistogramSeries,{priceLineVisible:false,lastValueVisible:false,base:0},3),
      chart.addSeries(L.HistogramSeries,{priceLineVisible:false,lastValueVisible:false,base:0},4),
      chart.addSeries(L.HistogramSeries,{priceLineVisible:false,lastValueVisible:false,base:0},5)
    ];
    state.band=new P.band({id:'flow-avwap-band',type:'band',points:[],label:'AVWAP',color:state.rules.colors.vwap,fill:state.rules.colors.sigma1Fill});
    state.anchorLine=new P.vline({id:'flow-avwap-anchor',type:'vline',time:0,label:'AVWAP anchor',color:state.rules.colors.anchor,style:'dashed'});
    state.candles.attachPrimitive(state.band);state.candles.attachPrimitive(state.anchorLine);
    for(let i=0;i<3;i++){
      const v=new P.vline({id:'depth-cutoff-'+i,type:'vline',time:0,label:'',color:state.rules.colors.depthCutoff,style:'dashed'});
      state.depthDelta[i].attachPrimitive(v);state.depthCutoff.push(v);
    }
    layoutPanes();
    new ResizeObserver(()=>{
      const before=chart.timeScale().getVisibleLogicalRange(),wasDefault=R.rangesClose(before,state.defaultViewRange,.5);
      chart.resize(container.clientWidth,container.clientHeight);layoutPanes();
      R.scheduleResize(state,wasDefault,before,chart,settleDefault);
    }).observe(container);
  }

  function layoutPanes(){
    if(!state.chart)return;
    const panes=state.chart.panes(),h=$('flowChart').clientHeight,p=state.rules.panes;
    const ratios=[p.price,p.perpCvd,p.spotCvd,p.depth1,p.depth2,p.depth3];
    for(let i=0;i<panes.length&&i<ratios.length;i++)panes[i].setHeight(Math.max(70,Math.round(h*Number(ratios[i]))));
    positionPaneLabels();
  }
  function positionPaneLabels(){
    const panes=state.chart&&state.chart.panes?state.chart.panes():[],root=$('paneLabels');if(!root)return;
    const labels=Array.from(root.children);let top=0;
    for(let i=0;i<labels.length;i++){labels[i].style.top=(top+6)+'px';top+=panes[i]&&panes[i].getHeight?panes[i].getHeight():0;}
  }
  function ensurePaneLabels(texts){
    const root=$('paneLabels');root.textContent='';
    for(const text of texts){const el=document.createElement('div');el.className='pane-label';el.textContent=text;root.appendChild(el);}
    positionPaneLabels();
  }

  function alignedAvwap(points,display){
    const sec=D.intervalSec(state.timeframe);
    const keys=['vwap','s1u','s1l','s2u','s2l'],maps={};
    for(const key of keys){
      const src=points.map(p=>({time:p.time,value:key==='vwap'?p.vwap:key==='s1u'?p.upper:key==='s1l'?p.lower:key==='s2u'?p.vwap+2*p.sigma:p.vwap-2*p.sigma}));
      maps[key]=new Map(E.alignSeriesToBars(src,display,sec).map(x=>[x.time,x.value]));
    }
    const out=[];
    for(const b of display){
      const t=Number(b.time);if(keys.every(k=>maps[k].has(t)))out.push({time:t,...Object.fromEntries(keys.map(k=>[k,maps[k].get(t)]))});
    }
    return out;
  }

  function anchorFor(bundle,closed15m){
    if(!closed15m.length)throw new Error('no closed 15m bars for AVWAP anchor');
    const last=closed15m[closed15m.length-1];
    if(state.anchorMode==='swing')return F.swingAnchor(closed15m,state.rules.avwap.lookbackDays);
    if(state.anchorMode==='week'){
      const t=F.utcWeekStart(last.time),bar=closed15m.find(b=>Number(b.time)===t);
      if(!bar)throw new Error('week AVWAP anchor is outside loaded 15m data');
      return{mode:'week',time:t,price:Number(bar.open)};
    }
    if(state.anchorMode==='quarter'){
      const t=E.utcQuarterStart(last.time),bars=bundle.perp1h||[],bar=bars.find(b=>Number(b.time)===t);
      if(!bar)throw new Error('quarter AVWAP requires current-quarter 1h history');
      return{mode:'quarter',time:t,price:Number(bar.open)};
    }
    if(state.anchorMode==='manual')return F.manualAnchor(closed15m,state.manualAnchorIso);
    throw new Error('unknown AVWAP anchor mode '+state.anchorMode);
  }

  function buildModel(bundle){
    const asOf=state.snapshot&&bundle.cutoffUtc?Date.parse(bundle.cutoffUtc)+1000:Date.now();
    const prep=bars=>(state.snapshot?D.closedBars(bars,asOf):bars).map(b=>({...b,live:!state.snapshot&&Number(b.closeTime)>=asOf}));
    const perp15=prep(bundle.perp15m||[]),spot15=prep(bundle.spot15m||[]);
    const display=F.aggregateBars(perp15,state.timeframe),spotDisplay=F.aggregateBars(spot15,state.timeframe);
    if(!display.length)throw new Error('display bars unavailable');
    const closed15=D.closedBars(bundle.perp15m||[],asOf),anchor=anchorFor(bundle,closed15);
    const calcBars=state.anchorMode==='quarter'?(bundle.perp1h||[]):bundle.perp15m||[];
    const raw=I.anchoredVwap(calcBars,anchor.time,1);
    if(!raw.length)throw new Error('AVWAP data unavailable from selected anchor');
    const avwap=alignedAvwap(raw,display),lastAv=avwap[avwap.length-1];
    const spec=R.defaultWindow(state.chart,state.rules,state.timeframe,display.length);
    const cvdIndex=Math.max(0,display.length-spec.visible),cvdAnchorTime=Number(display[cvdIndex].time);
    const perp=F.cvdSeries(display,display,cvdAnchorTime),spot=F.cvdSeries(display,spotDisplay,cvdAnchorTime);
    const depthPayload=bundle.depth||{snapshots:[],bucketsUsed:state.rules.depthBuckets,cutoffUtc:null,totalSnapshots:0,snapshotsRejected:0};
    const buckets=depthPayload.bucketsUsed||state.rules.depthBuckets;
    const depth=F.asOfDepth(display,depthPayload.snapshots||[],D.intervalSec(state.timeframe),buckets);
    return{
      symbol:state.symbol,timeframe:state.timeframe,display,spotDisplay,anchor,avwap,lastAv,perp,spot,depth,buckets,
      current:Number(display[display.length-1].close),visibleBars:spec.visible,cutoffUtc:bundle.cutoffUtc||null,
      depthCutoffUtc:depthPayload.cutoffUtc||null,depthTotal:Number(depthPayload.totalSnapshots)||0,
      depthRejected:Number(depthPayload.snapshotsRejected)||0,depthRawTotal:Number(depthPayload.rawSnapshots)||Number(depthPayload.totalSnapshots)||0,
      depthInvalidSnapshots:Number(depthPayload.invalidSnapshots)||0,depthInvalidDays:(depthPayload.invalidDays||[]).slice(),
      errors:bundle.errors||{},cvdAnchorTime
    };
  }

  function lwcLine(points){
    return(points||[]).map(p=>Number.isFinite(Number(p.value))?{time:D.toDisplayTime(p.time),value:Number(p.value)}:{time:D.toDisplayTime(p.time)});
  }
  function liveTail(points){
    const finite=(points||[]).filter(p=>Number.isFinite(Number(p.value))),live=finite.filter(p=>p.live);
    if(!live.length)return[];
    const first=live[0],idx=finite.findIndex(p=>p===first),out=[];if(idx>0)out.push(finite[idx-1]);out.push(...live);
    return lwcLine(out);
  }
  function depthSeries(model,index,key){
    const out=[];
    for(const row of model.depth.rows){
      if(!row.buckets||!row.buckets[index]){out.push({time:D.toDisplayTime(row.time)});continue;}
      out.push({time:D.toDisplayTime(row.time),value:Number(row.buckets[index][key])});
    }
    return out;
  }
  function depthHist(model,index){
    const out=[];
    for(const row of model.depth.rows){
      if(!row.buckets||!row.buckets[index]){out.push({time:D.toDisplayTime(row.time)});continue;}
      const v=Number(row.buckets[index].delta);
      out.push({time:D.toDisplayTime(row.time),value:v,color:v>=0?state.rules.colors.positive:state.rules.colors.negative});
    }
    return out;
  }

  function applySeries(model){
    const key=state.symbol+'|'+state.timeframe+'|'+state.anchorMode,same=state.viewKey===key;
    const oldRange=same?state.chart.timeScale().getVisibleLogicalRange():null,oldCount=state.lastDisplayCount||0;
    const followed=!!(oldRange&&Number(oldRange.to)>=oldCount-1);
    if(!same){
      const tick=Number(meta().tickSize)||.01,fmt={type:'price',precision:precision(),minMove:tick};
      state.candles.applyOptions({priceFormat:fmt});state.candles.priceScale().applyOptions({autoScale:true});
      for(const s of [state.perpCvd,state.spotCvd,...state.depthDelta,state.depthBid,state.depthAsk])s.priceScale().applyOptions({autoScale:true});
    }
    state.candles.setData(model.display.map(b=>({time:D.toDisplayTime(b.time),open:b.open,high:b.high,low:b.low,close:b.close})));
    state.band.item={id:'flow-avwap-band',type:'band',points:model.avwap.map(p=>[p.time,p.vwap,p.s1u,p.s1l]),label:'AVWAP ±1σ',color:state.rules.colors.vwap,fill:state.rules.colors.sigma1Fill};
    state.band.setContext({bars:model.display,intervalSec:D.intervalSec(state.timeframe),timeOffsetSec:9*3600,autoscale:true,priceFormatter:fmtPrice});
    state.anchorLine.item={id:'flow-avwap-anchor',type:'vline',time:model.anchor.time,label:'AVWAP anchor',color:state.rules.colors.anchor,style:'dashed'};
    state.anchorLine.setContext({bars:model.display,intervalSec:D.intervalSec(state.timeframe),timeOffsetSec:9*3600,autoscale:false});
    if(state.band.requestUpdate)state.band.requestUpdate();if(state.anchorLine.requestUpdate)state.anchorLine.requestUpdate();
    state.s2u.setData(model.avwap.map(p=>({time:D.toDisplayTime(p.time),value:p.s2u})));state.s2l.setData(model.avwap.map(p=>({time:D.toDisplayTime(p.time),value:p.s2l})));
    state.perpCvd.setData(lwcLine(model.perp.points));state.perpLive.setData(liveTail(model.perp.points));
    state.spotCvd.setData(lwcLine(model.spot.points));state.spotLive.setData(liveTail(model.spot.points));
    state.depthBid.setData(depthSeries(model,0,'bid'));state.depthAsk.setData(depthSeries(model,0,'ask'));
    for(let i=0;i<3;i++)state.depthDelta[i].setData(depthHist(model,i));
    const cutoff=model.depthCutoffUtc?Date.parse(model.depthCutoffUtc)/1000:null;
    for(let i=0;i<3;i++){
      state.depthCutoff[i].item={id:'depth-cutoff-'+i,type:'vline',time:cutoff||model.display[0].time,label:cutoff?'depth archive through '+String(model.depthCutoffUtc).slice(0,10)+' 23:59 UTC':'depth unavailable',color:state.rules.colors.depthCutoff,style:'dashed'};
      state.depthCutoff[i].setContext({bars:model.display,intervalSec:D.intervalSec(state.timeframe),timeOffsetSec:9*3600,autoscale:false});
      if(state.depthCutoff[i].requestUpdate)state.depthCutoff[i].requestUpdate();
    }
    const n=model.display.length,oldWasDefault=same&&R.rangesClose(oldRange,state.defaultViewRange,.5);
    let needsSettle=false;
    if(!same||!oldRange){R.applyDefaultView(state.chart,state.rules,state.timeframe,n,state);needsSettle=true;}
    else if(followed){const d=n-oldCount,next={from:Number(oldRange.from)+d,to:Number(oldRange.to)+d};state.chart.timeScale().setVisibleLogicalRange(next);if(oldWasDefault)state.defaultViewRange={from:next.from,to:next.to};needsSettle=oldWasDefault;}
    else{state.chart.timeScale().setVisibleLogicalRange(oldRange);if(oldWasDefault)state.defaultViewRange={from:Number(oldRange.from),to:Number(oldRange.to)};needsSettle=oldWasDefault;}
    state.viewKey=key;state.lastDisplayCount=n;
    layoutPanes();
    return needsSettle;
  }

  function latestDepth(model,index){
    for(let i=model.depth.rows.length-1;i>=0;i--){const b=model.depth.rows[i].buckets;if(b&&b[index])return b[index];}
    return null;
  }
  function updateLabels(model){
    const p=model.lastAv||{},d0=latestDepth(model,0),d1=latestDepth(model,1),d2=latestDepth(model,2);
    const bl=i=>{const x=model.buckets[i];return Number(x[0])+'-'+Number(x[1])+'%';};
    const anchorCalc=state.anchorMode==='quarter'?'1h calc':'15m calc';
    const depthThrough=model.depthCutoffUtc?' · through '+String(model.depthCutoffUtc).slice(0,10)+' 23:59 UTC':' · unavailable';
    ensurePaneLabels([
      'USD-M Perp · AVWAP '+state.anchorMode+' '+fmtPrice(p.vwap)+' · Binance USD-M · anchor '+D.formatJst(model.anchor.time)+' · '+anchorCalc,
      'Volume By Side (delta) Perpetuals '+F.formatSigned(model.perp.value)+' · Binance Perp · from '+D.formatJst(model.cvdAnchorTime),
      'Volume By Side (delta) Spot '+F.formatSigned(model.spot.value)+' · Binance Spot · from '+D.formatJst(model.cvdAnchorTime),
      'Depth '+bl(0)+' · bid '+F.formatSigned(d0&&d0.bid)+' / ask '+F.formatSigned(d0&&d0.ask)+' / Δ '+F.formatSigned(d0&&d0.delta)+' · Binance USD-M book'+depthThrough,
      'Depth '+bl(1)+' · Δ '+F.formatSigned(d1&&d1.delta)+' · Binance USD-M book'+depthThrough,
      'Depth '+bl(2)+' · Δ '+F.formatSigned(d2&&d2.delta)+' · Binance USD-M book'+depthThrough
    ]);
  }
  function renderTable(model){
    const rows=[],p=model.lastAv||{};
    rows.push(['AVWAP','锚点',state.anchorMode+' · '+fmtPrice(model.anchor.price),D.formatJst(model.anchor.time)+(state.anchorMode==='quarter'?' · 1h calc':' · 15m calc')]);
    rows.push(['AVWAP','当前','VWAP '+fmtPrice(p.vwap)+' · +1σ '+fmtPrice(p.s1u)+' · -1σ '+fmtPrice(p.s1l)+' · +2σ '+fmtPrice(p.s2u)+' · -2σ '+fmtPrice(p.s2l),F.positionText(model.current,p)]);
    rows.push(['CVD','Binance Perp',F.formatSigned(model.perp.value)+' · bars '+model.perp.matched+' · missing '+model.perp.missing,D.formatJst(model.cvdAnchorTime)]);
    rows.push(['CVD','Binance Spot',F.formatSigned(model.spot.value)+' · bars '+model.spot.matched+' · missing '+model.spot.missing,D.formatJst(model.cvdAnchorTime)]);
    for(let i=0;i<3;i++){const d=latestDepth(model,i),b=model.buckets[i];rows.push(['Depth',Number(b[0])+'-'+Number(b[1])+'%',d?'bid '+F.formatSigned(d.bid)+' · ask '+F.formatSigned(d.ask)+' · Δ '+F.formatSigned(d.delta):'—',model.depthCutoffUtc?'through '+String(model.depthCutoffUtc).slice(0,10)+' 23:59 UTC':'unavailable']);}
    const body=$('flowRows');body.textContent='';
    for(const row of rows){const tr=document.createElement('tr');for(const v of row){const td=document.createElement('td');td.textContent=v;tr.appendChild(td);}body.appendChild(tr);}
    model.tableText=rows.map(r=>r.join(' · '));
  }
  function updateHeader(model){
    $('boardTitle').textContent=meta().displayName+' · '+state.timeframe;
    document.querySelectorAll('[data-symbol]').forEach(b=>b.classList.toggle('active',b.dataset.symbol===state.symbol));
    document.querySelectorAll('[data-tf]').forEach(b=>b.classList.toggle('active',b.dataset.tf===state.timeframe));
    $('anchorMode').value=state.anchorMode;
    if(state.snapshot){
      $('infoLine').textContent=meta().displayName+' · '+tfLabel()+' · 收 '+fmtPrice(model.current)+' · 数据截至 '+fmtIsoJst(model.cutoffUtc)+' JST';
      $('cutoff').textContent='数据截至 '+fmtIsoJst(model.cutoffUtc)+' JST';
    }else{
      $('infoLine').textContent=meta().displayName+' · '+tfLabel()+' · 收 '+fmtPrice(model.current)+' · 最后刷新 '+D.formatDisplayTime(Math.floor(state.lastSuccessAt/1000)+9*3600)+' JST';
      $('cutoff').textContent=model.depthCutoffUtc?'实时 Kline · depth archive through '+String(model.depthCutoffUtc).slice(0,10)+' 23:59 UTC':'实时 Kline · depth unavailable';
    }
    const errs=Object.keys(model.errors||{});
    const invalid=model.depthInvalidDays.length?' · depth invalid days '+model.depthInvalidDays.length:'';
    $('status').textContent=state.refreshWarning?'刷新失败：'+state.refreshWarning:'Loaded '+model.display.length+' bars · AVWAP '+state.anchorMode+' · depth rejected '+model.depthRejected+'/'+model.depthTotal+invalid+(errs.length?' · 缺失 '+errs.join(', '):'');
    $('status').classList.toggle('error',!!state.refreshWarning||errs.length>0);
    updateLabels(model);
  }

  async function settleDefault(shouldContinue){
    if(!state.model)return;let stable=0,last=-1;
    for(let i=0;i<10&&stable<3;i++){
      await R.nextFrame();if(shouldContinue&&!shouldContinue())return;
      const width=Number(state.chart.timeScale().width()),spec=R.defaultWindow(state.chart,state.rules,state.timeframe,state.model.display.length);
      if(spec.visible!==state.model.visibleBars&&state.bundle){
        const rebuilt=buildModel(state.bundle);state.model=rebuilt;
        applySeries(rebuilt);renderTable(rebuilt);updateLabels(rebuilt);
      }
      R.applyDefaultView(state.chart,state.rules,state.timeframe,state.model.display.length,state);
      if(Math.abs(width-last)<.5)stable++;else stable=0;last=width;
    }
  }
  function resetView(){
    if(!state.model||!state.bundle)return;
    R.resetView([state.candles,state.perpCvd,state.spotCvd,state.depthBid,state.depthAsk,...state.depthDelta],state.chart,null);
    state.viewKey=null;
    const rebuilt=buildModel(state.bundle);state.model=rebuilt;
    applySeries(rebuilt);renderTable(rebuilt);updateHeader(rebuilt);
    const spec=R.applyDefaultView(state.chart,state.rules,state.timeframe,rebuilt.display.length,state);rebuilt.visibleBars=spec.visible;
  }

  async function getBundle(token,full,signal){
    if(state.snapshot)return{bundle:await FD.loadSnapshot(state.symbol,signal),full:true,failures:[]};
    const doFull=full||!state.bundle||state.bundle.symbol!==state.symbol||Date.now()-state.lastFullLoadAt>=30*60*1000;
    if(doFull){
      const bundle=await FD.loadLive(state.symbol,state.anchorMode,manualMs(),p=>{if(token===state.loadToken)$('status').textContent='Loading '+p.done+'/'+p.total+' · '+p.label;},signal);
      state.lastFullLoadAt=Date.now();return{bundle,full:true,failures:[]};
    }
    return FD.refreshLiveBundle(state.bundle,state.symbol,state.anchorMode,manualMs(),signal);
  }
  async function refresh(forceFull,options){
    return R.runRefresh(state,forceFull,options,{
      before:()=>loadRules(),load:(token,full,signal)=>getBundle(token,full,signal),
      apply:async result=>{
        state.bundle=result.bundle;state.refreshWarning=result.failures&&result.failures.length?result.failures.map(x=>x.interval).join(', ')+' 更新失败':null;
        const model=buildModel(result.bundle);state.model=model;const needsSettle=applySeries(model);renderTable(model);if(needsSettle)await settleDefault();state.lastSuccessAt=Date.now();updateHeader(model);return model;
      },
      error:e=>{console.error(e);state.refreshWarning=String(e.message||e);$('status').textContent='加载失败：'+state.refreshWarning;$('status').classList.add('error');return null;}
    });
  }

  function setSelection(symbol,tf,anchorMode){
    const symbolChanged=symbol&&symbol!==state.symbol;
    if(symbol&&SYMBOLS[symbol])state.symbol=symbol;if(['15m','30m'].includes(tf))state.timeframe=tf;
    if(['swing','week','quarter','manual'].includes(anchorMode))state.anchorMode=anchorMode;
    if(symbolChanged){state.bundle=null;state.lastFullLoadAt=0;}
    const q=new URLSearchParams(location.search);q.set('symbol',state.symbol);q.set('tf',state.timeframe);q.set('anchor',state.anchorMode);if(state.manualAnchorIso)q.set('avwapAnchor',state.manualAnchorIso);if(state.snapshot)q.set('snapshot','1');
    history.replaceState(null,'',location.pathname+'?'+q.toString());refresh(symbolChanged,{cancelPrevious:true});
  }

  async function downloadPng(){
    if(!state.model)return;$('downloadBtn').disabled=true;
    try{
      const panes=state.chart.panes(),labels=Array.from($('paneLabels').children),paneLabels=[];let top=0;
      for(let i=0;i<labels.length;i++){paneLabels.push({y:top,text:labels[i].textContent});top+=panes[i]&&panes[i].getHeight?panes[i].getHeight():0;}
      await X.exportFlowBoard({chart:state.chart,title:$('boardTitle').textContent,info:$('infoLine').textContent,paneLabels,rows:state.model.tableText||[],footer:$('cutoff').textContent,filename:state.symbol+'-flow-'+state.timeframe+'.png'});
    }finally{$('downloadBtn').disabled=false;}
  }

  function view(){
    const range=state.chart&&state.chart.timeScale().getVisibleLogicalRange();
    return{range,logicalSlots:range?Number(range.to)-Number(range.from):null,visibleBars:state.model&&state.model.visibleBars};
  }

  async function init(){
    const q=new URLSearchParams(location.search);
    state.symbol=SYMBOLS[q.get('symbol')]?q.get('symbol'):'BTCUSDT';state.timeframe=['15m','30m'].includes(q.get('tf'))?q.get('tf'):'15m';
    state.anchorMode=['swing','week','quarter','manual'].includes(q.get('anchor'))?q.get('anchor'):'swing';state.manualAnchorIso=q.get('avwapAnchor');state.snapshot=q.get('snapshot')==='1';
    if(state.snapshot)document.body.classList.add('snapshot');
    await loadRules();createChart();
    document.querySelectorAll('[data-symbol]').forEach(b=>b.addEventListener('click',()=>setSelection(b.dataset.symbol,state.timeframe,state.anchorMode)));
    document.querySelectorAll('[data-tf]').forEach(b=>b.addEventListener('click',()=>setSelection(state.symbol,b.dataset.tf,state.anchorMode)));
    $('anchorMode').addEventListener('change',()=>setSelection(state.symbol,state.timeframe,$('anchorMode').value));
    $('resetViewBtn').addEventListener('click',resetView);$('downloadBtn').addEventListener('click',downloadPng);
    window.__flowDebug={state,get model(){return state.model;},refresh:(full)=>refresh(!!full),view,resetView,paneCount:()=>state.chart.panes().length,
      seriesTimes:()=>({price:state.model?state.model.display.map(x=>x.time):[],perp:state.model?state.model.perp.points.map(x=>x.time):[],spot:state.model?state.model.spot.points.map(x=>x.time):[],depth:state.model?state.model.depth.rows.map(x=>x.time):[]})};
    await refresh(true);
    if(!state.snapshot)R.startRefreshLoop(state,Number(state.rules.display.refreshSeconds||60)*1000,refresh);
  }
  init();
})();