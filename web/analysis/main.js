(function(){
  'use strict';

  const L=window.LightweightCharts,D=window.OrderFlowAnalysisData,E=window.OrderFlowAnalysisEngine,I=window.OrderFlowIndicators,AP=window.OrderFlowAnnotationPrimitives,P=window.OrderFlowAnalysisPrimitive,X=window.OrderFlowAnalysisExport,R=window.OrderFlowBoardRuntime;
  const SYMBOLS=window.ORDER_FLOW_SYMBOLS||{};
  const WATERMARK_COLOR='rgba(196,140,60,.30)';
  const $=id=>document.getElementById(id);
  const state={
    symbol:'BTCUSDT',timeframe:'1h',template:'quarter',viewMode:'quarter',snapshot:false,rules:null,bundle:null,chart:null,candles:null,volume:null,quarterBands:[],primitive:null,
    loadToken:0,refreshTimer:null,model:null,viewKey:null,lastDisplayCount:0,lastFullLoadAt:0,refreshWarning:null,
    inFlight:null,abortController:null,lastSuccessAt:0,defaultViewRange:null,resizeToken:0,resizeSettle:null,watermark:null,countdownTimer:null,crosshairTime:null
  };

  function tfLabel(tf){return({'1h':'1小时','4h':'4小时','1d':'1天'})[tf]||tf;}
  function symbolMeta(){return SYMBOLS[state.symbol]||{displayName:state.symbol,tickSize:'0.01',ladderBin:'0.1'};}
  function pricePrecision(){const s=String(symbolMeta().tickSize||'0.01'),i=s.indexOf('.');return i<0?0:s.length-i-1;}
  function templateConfig(){const all=state.rules&&state.rules.templates||{};return all[state.template]||all.combined||{};}
  function layerEnabled(name){const layers=templateConfig().layers||{};return layers[name]!==false;}
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
    document.querySelectorAll('[data-tf]').forEach(b=>{const allowed=(cfg.timeframes||[]).includes(b.dataset.tf);b.style.display=allowed?'':'none';b.disabled=!allowed;});
    const meta=document.querySelector('.capture-meta');if(meta)meta.textContent=String(cfg.label||state.template).toUpperCase();
  }
  function syncVolumeLayer(){
    if(!state.chart)return;
    if(layerEnabled('volume')){
      if(!state.volume)state.volume=state.chart.addSeries(L.HistogramSeries,{priceFormat:{type:'volume'},priceLineVisible:false,lastValueVisible:false},1);
      const panes=state.chart.panes();if(state.volume&&panes[1])panes[1].setHeight(Math.max(105,Math.round($('analysisChart').clientHeight*.18)));
    }else if(state.volume){state.chart.removeSeries(state.volume);state.volume=null;}
  }
  function regionLayerEnabled(r){if(r.type!=='value')return layerEnabled('zones');if(r.scope==='PQ')return layerEnabled('pqArea');if(r.scope==='PM')return layerEnabled('pm');if(r.scope==='PW')return layerEnabled('pw');return true;}
  function levelLayerEnabled(l){if(l.kind==='pq')return layerEnabled('pqVwap');if(l.kind==='pq-bound')return layerEnabled('pqBounds');if(l.kind==='npoc')return layerEnabled('nPoc');if(l.kind==='key')return layerEnabled('keyLevels');return true;}
  function fmtPrice(v){
    const p=pricePrecision(),tick=Number(symbolMeta().tickSize)||.01,n=E.roundToTick(Number(v),tick);
    return n.toLocaleString(undefined,{minimumFractionDigits:p,maximumFractionDigits:p});
  }
  function jstParts(ms){
    const parts=new Intl.DateTimeFormat('en-GB',{
      timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
    }).formatToParts(new Date(Number(ms)));
    const out={};for(const p of parts)if(p.type!=='literal')out[p.type]=p.value;return out;
  }
  function formatJstClock(ms){const p=jstParts(ms);return p.hour+':'+p.minute+':'+p.second;}
  function formatCutoffJst(iso){
    const ms=Date.parse(String(iso||''));if(!Number.isFinite(ms))return'—';
    const p=jstParts(ms);return p.year+'/'+p.month+'/'+p.day+' '+p.hour+':'+p.minute;
  }
  function legendEntries(){
    const c=state.rules&&state.rules.colors||{};
    return[
      {key:'pq',label:'PQ 上季价值区',kind:'box',color:c.pqBorder},
      {key:'pm',label:'PM 上月价值区',kind:'box',color:c.pmBorder},
      {key:'pw',label:'PW 上周价值区',kind:'box',color:c.pwBorder},
      {key:'supply',label:'供应区',kind:'box',color:c.supplyBorder},
      {key:'demand',label:'需求区',kind:'box',color:c.demandBorder},
      {key:'current-vwap',label:'本季 VWAP ±1σ',kind:'line',color:c.vwap},
      {key:'pq-vwap',label:'PQ VWAP',kind:'line',color:c.pqVwap},
      {key:'npoc',label:'未回补 POC',kind:'dash',color:c.nPoc},
      {key:'key-level',label:'关键价位',kind:'dash',color:c.keyLevel}
    ];
  }
  function renderLegend(){
    const root=$('analysisLegend');if(!root)return;
    root.textContent='';
    for(const e of legendEntries()){
      const item=document.createElement('span');item.className='legend-item';item.dataset.legend=e.key;
      const mark=document.createElement('i');mark.className='legend-mark '+(e.kind==='box'?'legend-box':(e.kind==='dash'?'legend-dash':'legend-line'));
      if(e.kind==='box')mark.style.backgroundColor=e.color;else mark.style.color=e.color;
      item.appendChild(mark);item.appendChild(document.createTextNode(e.label));root.appendChild(item);
    }
  }
  const rangesClose=R.rangesClose;
  function fillAlpha(base,tested){
    if(!tested)return base;
    if(base.startsWith('rgba('))return base.replace(/,[^,]+\)$/g,',.08)');
    return base;
  }
  function distancePct(current,bottom,top){
    if(current>=bottom&&current<=top)return 0;
    const d=current>top?current-top:bottom-current;return Math.abs(d/current*100);
  }
  function periodEndFromProfile(profile){
    const p=profile&&profile.profiles&&profile.profiles.previous,days=p&&(p.expectedDays||p.days);
    if(!days||!days.length)return null;
    return Date.parse(days[days.length-1]+'T00:00:00Z')/1000+86400;
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
    state.chart=chart;state.candles=candles;state.volume=null;state.primitive=primitive;syncVolumeLayer();
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

  function previousMonthTpo(thirty,lastTime,tickSize){
    const mStart=E.utcMonthStart(lastTime),pmStart=E.previousMonthStart(lastTime);
    const bars=thirty.filter(b=>b.time>=pmStart&&b.time<mStart);
    if(!bars.length)return null;
    const p=E.tpoProfile(bars,tickSize*Number(state.rules.nakedPoc.tpoTicksPerRow||100));
    return p&&Number.isFinite(p.poc)?{...p,from:mStart,bars}:null;
  }

  function previousWeekTpo(thirty,lastTime,tickSize){
    const wEnd=E.utcWeekStart(lastTime),wStart=wEnd-7*86400,bars=thirty.filter(b=>b.time>=wStart&&b.time<wEnd);
    if(!bars.length)return null;
    const p=E.tpoProfile(bars,tickSize*Number(state.rules.nakedPoc.tpoTicksPerRow||100));
    return p&&Number.isFinite(p.poc)?{...p,from:wEnd,bars}:null;
  }

  function pmArea(oneHour,thirty,lastTime){
    const cfg=state.rules.valueAreas.pm,def=cfg.definition,mStart=E.utcMonthStart(lastTime),pmStart=E.previousMonthStart(lastTime);
    if(def==='tpo-70'){
      const bars=thirty.filter(b=>b.time>=pmStart&&b.time<mStart);
      const p=E.tpoProfile(bars,(Number(symbolMeta().tickSize)||.01)*Number(state.rules.nakedPoc.tpoTicksPerRow||100));
      if(p&&Number.isFinite(p.vah))return{bottom:p.val,top:p.vah,mid:p.poc,source:'approx',definition:def};
      return null;
    }
    const bars=oneHour.filter(b=>b.time>=pmStart&&b.time<mStart);
    if(!bars.length)return null;
    if(def==='anchored-vwap-2sigma'){
      const s=E.weightedStats(bars);if(!s)return null;
      return{bottom:s.vwap-2*s.sigma,top:s.vwap+2*s.sigma,mid:s.vwap,source:'approx',definition:def};
    }
    const p=E.approxVolumeProfile(bars,Number(symbolMeta().ladderBin)||.1);
    if(!p||!Number.isFinite(p.vah))return null;
    return{bottom:p.val,top:p.vah,mid:p.poc,source:'approx',definition:'volume-profile-70'};
  }

  function extrema(bars){
    let min=Infinity,max=-Infinity;
    for(const b of bars||[]){if(Number(b.low)<min)min=Number(b.low);if(Number(b.high)>max)max=Number(b.high);}
    return{min,max,span:Math.max(1e-12,max-min)};
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


  function quarterVwapSegments(oneHour,display){
    if(!oneHour.length||!display.length)return[];
    const starts=[];let q=E.utcQuarterStart(display[0].time),end=E.utcQuarterStart(display[display.length-1].time);
    while(q<=end){starts.push(q);const d=new Date(q*1000);q=Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+3,1)/1000;}
    const sec=D.intervalSec(state.timeframe),segments=[];
    for(const start of starts){
      const d=new Date(start*1000),next=Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+3,1)/1000;
      const calc=oneHour.filter(b=>Number(b.time)>=start&&Number(b.time)<next);if(!calc.length)continue;
      const raw=I.anchoredVwap(calc,start,1);if(!raw.length)continue;
      const target=display.filter(b=>Number(b.time)>=start&&Number(b.time)<next),maps={};
      for(const key of ['vwap','upper','lower'])maps[key]=new Map(E.alignSeriesToBars(raw.map(p=>({time:p.time,value:p[key]})),target,sec).map(p=>[p.time,p.value]));
      const points=[];for(const b of target){const t=Number(b.time);if(maps.vwap.has(t)&&maps.upper.has(t)&&maps.lower.has(t))points.push({time:t,vwap:maps.vwap.get(t),upper:maps.upper.get(t),lower:maps.lower.get(t)});}
      if(points.length)segments.push({start,end:next,points,final:points[points.length-1]});
    }
    return segments;
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
    const last=display[display.length-1],current=Number(last.close),qStart=E.utcQuarterStart(last.time),pqStart=E.previousQuarterStart(last.time),areas=[],missing=[];

    const pqBars=one.filter(b=>b.time>=pqStart&&b.time<qStart),pqStats=E.weightedStats(pqBars);
    if(pqStats&&pqBars.length&&pqBars[0].time<=pqStart+3600){
      areas.push({id:'value-pq',type:'value',scope:'PQ',bottom:pqStats.lower,top:pqStats.upper,from:qStart,
        label:'上季价值区 PQ',tableType:'价值区 PQ',period:'Q / 1h',source:'exact',tested:E.wasZoneTouched(one,qStart,pqStats.lower,pqStats.upper),
        fill:rules.colors.pqFill,border:rules.colors.pqBorder,borderStyle:'dashed',pqVwap:pqStats.vwap});
    }else missing.push({type:'价值区 PQ',period:'Q / 1h',source:'exact'});

    const pm=pmArea(one,thirty,last.time),mStart=E.utcMonthStart(last.time);
    if(pm){
      areas.push({id:'value-pm',type:'value',scope:'PM',bottom:pm.bottom,top:pm.top,from:mStart,
        label:'上月价值区 PM'+(pm.source==='approx'?' ≈':''),tableType:'价值区 PM',period:'M / '+(pm.definition==='tpo-70'?'30m TPO':'1h'),
        source:pm.source,tested:E.wasZoneTouched(one,mStart,pm.bottom,pm.top),fill:rules.colors.pmFill,border:rules.colors.pmBorder});
    }else missing.push({type:'价值区 PM',period:'M',source:'approx'});

    const weekAsOf=state.snapshot&&bundle.cutoffUtc?(Date.parse(bundle.cutoffUtc)+1000)/1000:Date.now()/1000;
    const profileFresh=E.profileIsFresh(bundle.profile,weekAsOf);
    const exactPw=profileFresh?E.exactProfile(bundle.profile):null;
    const exactWeekEnd=profileFresh?periodEndFromProfile(bundle.profile):null;
    const fallbackPw=!exactPw?previousWeekTpo(thirty,weekAsOf,tick):null;
    let pw=null,weekEnd=null;
    if(exactPw&&exactWeekEnd){
      pw={...exactPw,source:'exact'};weekEnd=exactWeekEnd;
      areas.push({id:'value-pw',type:'value',scope:'PW',bottom:pw.val,top:pw.vah,from:weekEnd,
        label:'上周价值区 PW',tableType:'价值区 PW',period:'W / aggTrades',source:'exact',
        tested:E.wasZoneTouched(thirty.length?thirty:one,weekEnd,pw.val,pw.vah),fill:rules.colors.pwFill,border:rules.colors.pwBorder});
    }else if(fallbackPw){
      pw={...fallbackPw,source:'approx'};weekEnd=fallbackPw.from;
      areas.push({id:'value-pw-tpo',type:'value',scope:'PW',bottom:pw.val,top:pw.vah,from:weekEnd,
        label:'上周价值区 PW ≈',tableType:'价值区 PW',period:'W / 30m TPO',source:'approx',
        tested:E.wasZoneTouched(thirty,weekEnd,pw.val,pw.vah),fill:rules.colors.pwFill,border:rules.colors.pwBorder});
    }else missing.push({type:'价值区 PW',period:'W / aggTrades or 30m TPO',source:'approx'});

    const allAreas=E.suppressValueAreas(areas,rules.valueAreas.overlapSuppressPct,rules.valueAreas.maxCount||3);
    const drawnAreaIds=new Set(E.filterValueAreas(allAreas,view.min,view.max,rules.valueAreas.visiblePadPct,rules.valueAreas.overlapSuppressPct).map(x=>x.id));

    const asOfMs=state.snapshot&&bundle.cutoffUtc?Date.parse(bundle.cutoffUtc)+1000:Date.now();
    const closedCalc=D.closedBars(calc,asOfMs);
    let selectedZones=[];
    if(closedCalc.length){
      const detected=E.detectZones(closedCalc,rules.zones);
      selectedZones=E.selectZones(E.markZoneTouches(detected,calc),current,rules.zones).map(z=>{
        const supply=z.type==='supply',baseFill=supply?rules.colors.supplyFill:rules.colors.demandFill,border=supply?rules.colors.supplyBorder:rules.colors.demandBorder;
        const stateText=z.zoneState==='inside'?'·测试中':(z.zoneState==='breaking'?'·击穿待确认':(z.tested?'·已测试':''));
        return{...z,type:z.type,fill:fillAlpha(baseFill,z.tested),border,period:calcTf,source:'exact',
          label:(supply?'供应区':'需求区')+stateText+' · '+calcTf.toUpperCase()+' · '+z.strength.toFixed(1)+'ATR',
          tableType:supply?'供应区':'需求区'};
      });
    }else missing.push({type:'供应/需求区',period:calcTf,source:'exact'});

    const drawnZoneIds=new Set(selectedZones.filter(z=>E.zoneIntersectsView(z,view.min,view.max,rules.zones.viewPadPct||50)).map(z=>z.id));

    const allLevels=[];
    const pq=areas.find(a=>a.scope==='PQ');
    if(pq&&layerEnabled('pqVwap'))allLevels.push({id:'line-pq-vwap',kind:'pq',price:pq.pqVwap,from:qStart,label:'PQ VWAP',color:rules.colors.pqVwap,style:'solid',period:'Q / 1h',source:'exact'});
    if(pq&&layerEnabled('pqBounds')){
      allLevels.push({id:'line-pq-vah',kind:'pq-bound',price:pq.top,from:qStart,label:'PQ VAH',color:rules.colors.keyLevel,axisColor:rules.colors.keyAxis,axisLabel:false,style:'dashed',width:1,period:'Q / 1h VWAP±1σ',source:'exact'});
      allLevels.push({id:'line-pq-val',kind:'pq-bound',price:pq.bottom,from:qStart,label:'PQ VAL',color:rules.colors.keyLevel,axisColor:rules.colors.keyAxis,axisLabel:false,style:'dashed',width:1,period:'Q / 1h VWAP±1σ',source:'exact'});
    }

    const pocCandidates=[];
    if(pw&&weekEnd&&E.isPocNaked(pw.poc,weekEnd,thirty.length?thirty:one)){
      pocCandidates.push({id:pw.source==='exact'?'npoc-week':'npoc-week-tpo',kind:'npoc',price:pw.poc,from:weekEnd,
        label:pw.source==='exact'?'nPOC W':'nPOC W ≈',color:rules.colors.nPoc,style:'dashed',
        period:pw.source==='exact'?'W / aggTrades':'W / 30m TPO',source:pw.source});
    }
    const mt=previousMonthTpo(thirty,last.time,tick);
    if(mt&&E.isPocNaked(mt.poc,mt.from,thirty))pocCandidates.push({id:'npoc-month',kind:'npoc',price:mt.poc,from:mt.from,label:'nPOC M ≈',color:rules.colors.nPoc,style:'dashed',period:'M / 30m TPO',source:'approx'});
    allLevels.push(...E.selectNakedPocs(pocCandidates,current,rules.nakedPoc.maxCount));

    const linePad=rules.valueAreas.visiblePadPct;
    let keySelection={all:[],selected:[]};
    if(bundle.keyLevels&&Array.isArray(bundle.keyLevels.levels)){
      const keyAsOfMs=state.snapshot&&bundle.cutoffUtc?Date.parse(bundle.cutoffUtc):Date.now();
      const closedDisplay=D.closedBars(display,keyAsOfMs);
      const lastClosedDisplay=closedDisplay[closedDisplay.length-1];
      const keyPeriodCutoffMs=lastClosedDisplay&&Number.isFinite(Number(lastClosedDisplay.closeTime))
        ?Number(lastClosedDisplay.closeTime)+1:keyAsOfMs;
      const eligibleKeyLevels=bundle.keyLevels.levels.filter(row=>{
        const periodEnd=Date.parse(String(row.periodEnd||''));
        return Number.isFinite(periodEnd)&&periodEnd<=keyPeriodCutoffMs;
      });
      const keyCfg=rules.keyLevels||{};
      keySelection=E.selectKeyLevels(
        eligibleKeyLevels,current,view.min,view.max,linePad,tick,keyCfg.maxCount||6,pqStart,
        keyCfg.maxMonthly||2,keyCfg.minGapPct||2,pq?[pq.bottom,pq.top]:[]
      );
      const firstTime=Number(display[0].time),keyStyle=templateConfig().keyLevelStyle||{};
      for(const row of keySelection.all){
        const monthly=row.keyKind==='py-month';
        allLevels.push({
          id:'key-'+row.id,kind:'key',price:Number(row.price),from:firstTime,label:row.label,
          color:keyStyle.color||(monthly?rules.colors.keyMonth:rules.colors.keyLevel),axisColor:rules.colors.keyAxis,axisLabel:keyStyle.axisLabel,
          style:keyStyle.style||(monthly?'solid':'dashed'),width:1,period:monthly?'M / 30m TPO':'Q / 1h VWAP±1σ',
          source:'precomputed',keyKind:row.keyKind,sourceId:row.id
        });
      }
    }else missing.push({type:'关键价位',period:'Q / 1h VWAP±1σ + M / 30m TPO',source:'precomputed'});

    const selectedKeyIds=new Set(keySelection.selected.map(x=>'key-'+x.id));
    const drawnLevelIds=new Set(allLevels.filter(l=>l.kind==='key'?selectedKeyIds.has(l.id):E.inPriceView(l.price,view.min,view.max,linePad)).map(l=>l.id));

    const allRegions=allAreas.concat(selectedZones).map(r=>({...r,offView:r.type==='value'?!drawnAreaIds.has(r.id):!drawnZoneIds.has(r.id)}));
    const levelsForTable=allLevels.map(l=>({...l,offView:!drawnLevelIds.has(l.id)}));
    const regions=allRegions.filter(r=>!r.offView&&regionLayerEnabled(r)),levels=levelsForTable.filter(l=>!l.offView&&levelLayerEnabled(l));

    const quarterVwaps=quarterVwapSegments(one,display);
    const currentVwap=(quarterVwaps.find(x=>x.start===qStart)||quarterVwaps[quarterVwaps.length-1]||{points:[]}).points.map(p=>({time:p.time,value:p.vwap}));
    const lastClosed=closedCalc[closedCalc.length-1];
    const calcLastClosedUtc=lastClosed?new Date(Number(lastClosed.closeTime)+1).toISOString():null;
    return{
      symbol:state.symbol,timeframe:state.timeframe,display,last,current,regions,levels,currentVwap,quarterVwaps,pqStats,keyLevels:levels.filter(l=>l.kind==='key'),missing,
      allRegions,allLevels:levelsForTable,viewMin:view.min,viewMax:view.max,visibleBars:visibleN,
      cutoffUtc:bundle.cutoffUtc||null,generatedAt:bundle.generatedAt||new Date().toISOString(),
      calcTf,calcLastClosedUtc,bundleErrors:bundle.errors||{},
      tableRows:templateConfig().table===false?[]:sourceRows({regions:allRegions,levels:levelsForTable,current,missing})
    };
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
      const visible=win.mode==='quarter'?count:Math.min(count,Number(win.visibleBars)||count),right=marginBars(visible,marginPct),from=Math.max(0,count-visible);
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
    const candleData=model.display.map(b=>({time:D.toDisplayTime(b.time),open:b.open,high:b.high,low:b.low,close:b.close}));
    const volumeData=model.display.map(b=>({time:D.toDisplayTime(b.time),value:b.volume,color:b.close>=b.open?'rgba(230,234,242,.42)':'rgba(230,234,242,.68)'}));
    state.candles.setData(candleData);if(state.volume)state.volume.setData(volumeData);
    for(let i=0;i<state.quarterBands.length;i++){const seg=layerEnabled('quarterBands')?model.quarterVwaps[i]:null,b=state.quarterBands[i];b.item={id:'quarter-band-'+i,type:'band',points:seg?seg.points.map(p=>[p.time,p.vwap,p.upper,p.lower]):[],label:'',color:state.rules.colors.vwap,fill:state.rules.colors.quarterBandFill};b.setContext({bars:model.display,intervalSec:D.intervalSec(state.timeframe),timeOffsetSec:9*3600,autoscale:true,priceFormatter:fmtPrice});if(b.requestUpdate)b.requestUpdate();}
    const autoscaleSpan=Math.max(1e-12,Number(model.viewMax)-Number(model.viewMin));
    const autoscalePad=autoscaleSpan*Number(state.rules.valueAreas.visiblePadPct||0)/100;
    state.primitive.setModel({
      regions:model.regions,levels:model.levels,bars:model.display,currentPrice:model.current,
      autoscaleMin:Number(model.viewMin)-autoscalePad,autoscaleMax:Number(model.viewMax)+autoscalePad,
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
  function infoValues(model){
    const cur=model.quarterVwaps.find(x=>x.start===E.utcQuarterStart(model.last.time))||model.quarterVwaps[model.quarterVwaps.length-1],c=cur&&cur.final||{};
    const prevStart=E.previousQuarterStart(model.last.time),prev=model.quarterVwaps.find(x=>x.start===prevStart),p=prev&&prev.final||model.pqStats||{};
    return{current:c,previous:{vwap:p.vwap,upper:p.upper,lower:p.lower}};
  }
  function updateChartInfo(model,time){
    if(!model)return;const target=Number.isFinite(Number(time))?Number(time):Number(model.last.time);
    const bar=model.display.find(b=>Number(b.time)===target)||model.last,chg=Number(bar.close)-Number(bar.open),pct=Number(bar.open)?chg/Number(bar.open)*100:0,cls=chg>=0?'up':'down';
    const line1=$('chartInfo1');line1.textContent='';
    const a=document.createElement('span');a.className='muted';a.textContent=symbolMeta().displayName+' · '+tfLabel(state.timeframe)+' · Binance  开='+fmtPrice(bar.open)+' 高='+fmtPrice(bar.high)+' 低='+fmtPrice(bar.low)+' 收='+fmtPrice(bar.close)+' ';line1.appendChild(a);
    const b=document.createElement('span');b.className=cls;b.textContent='涨跌 '+(chg>=0?'+':'')+fmtPrice(chg)+' ('+(pct>=0?'+':'')+pct.toFixed(2)+'%)';line1.appendChild(b);
    const c=document.createElement('span');c.className='muted';c.textContent=' 量 '+formatVolume(bar.volume);line1.appendChild(c);
    const vals=infoValues(model),cv=vals.current,pv=vals.previous,line2=$('chartInfo2');line2.textContent='Anchored VWAP (hlc3, Quarter, ±1σ)';
    const add=(text,klass)=>{const e=document.createElement('span');e.className=klass;e.textContent=text;line2.appendChild(e);};
    add('  '+fmtPrice(cv.vwap),'vwap');add('  +1σ '+fmtPrice(cv.upper),'sigma');add('  −1σ '+fmtPrice(cv.lower),'sigma');add('  PQ '+fmtPrice(pv.vwap),'pqvwap');add('  +1σ '+fmtPrice(pv.upper),'sigma');add('  −1σ '+fmtPrice(pv.lower),'sigma');
    model.infoValues={current:cv,previous:pv,barTime:Number(bar.time)};
  }
  function formatRemaining(ms){const sec=Math.max(0,Math.floor(ms/1000)),h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;return h>0?String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0'):String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');}
  function updateCountdown(){
    const el=$('closeCountdown');if(state.snapshot||!state.model){el.style.display='none';el.textContent='';return;}
    const bar=state.model.last,closeMs=Number(bar.closeTime),left=closeMs-Date.now();if(!Number.isFinite(closeMs)||left<0){el.style.display='none';el.textContent='';return;}
    el.textContent=fmtPrice(state.model.current)+' · '+formatRemaining(left);const y=state.candles.priceToCoordinate(state.model.current);if(y==null){el.style.display='none';return;}el.style.top=Math.max(2,Number(y)-10)+'px';el.style.display='block';
  }

  function updateSelectionState(){
    $('boardTitle').textContent=symbolMeta().displayName+' · '+tfLabel(state.timeframe);
    document.querySelectorAll('[data-symbol]').forEach(b=>b.classList.toggle('active',b.dataset.symbol===state.symbol));
    document.querySelectorAll('[data-tf]').forEach(b=>b.classList.toggle('active',b.dataset.tf===state.timeframe));
    document.querySelectorAll('[data-tpl]').forEach(b=>b.classList.toggle('active',b.dataset.tpl===state.template));
    applyTemplateChrome();
    if(state.watermark)state.watermark.applyOptions({lines:[{text:symbolMeta().displayName+', '+tfLabel(state.timeframe),color:WATERMARK_COLOR,fontSize:44,fontStyle:'bold'}]});
  }

  function updateHeader(model){
    updateSelectionState();
    if(state.snapshot){
      $('infoLine').textContent=symbolMeta().displayName+' · '+tfLabel(state.timeframe)+' · 收 '+fmtPrice(model.current)+' · 数据截至 '+formatCutoffJst(model.cutoffUtc);
      $('cutoff').textContent='数据截至 '+formatCutoffJst(model.cutoffUtc)+' JST';
    }else{
      $('infoLine').textContent=symbolMeta().displayName+' · '+tfLabel(state.timeframe)+' · 收 '+fmtPrice(model.current)+' · 最后刷新 '+formatJstClock(state.lastSuccessAt)+' JST';
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
      },signal);
      state.lastFullLoadAt=Date.now();
      return{bundle,full:true,failures:[]};
    }
    const inc=await D.refreshLiveBundle(state.bundle,state.symbol,state.timeframe,signal);
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
    if(['4h','1h','1d'].includes(tf))state.timeframe=tf;
    state.bundle=null;state.lastFullLoadAt=0;state.refreshWarning=null;
    updateSelectionState();
    $('infoLine').textContent=symbolMeta().displayName+' · '+tfLabel(state.timeframe)+' · 加载中…';
    $('status').textContent='Loading…';$('status').classList.remove('error');
    const q=new URLSearchParams(location.search);q.set('symbol',state.symbol);q.set('tf',state.timeframe);q.set('tpl',state.template);if(state.template==='combined')q.set('view',state.viewMode);else q.delete('view');if(state.snapshot)q.set('snapshot','1');
    history.replaceState(null,'',location.pathname+'?'+q.toString());refresh(true,{cancelPrevious:true});
  }

  function setTemplate(template){
    const all=state.rules&&state.rules.templates||{};if(!all[template]||template===state.template)return;
    state.template=template;state.viewMode='quarter';
    const cfg=templateConfig();if(!(cfg.timeframes||[]).includes(state.timeframe))state.timeframe=cfg.defaultTimeframe||(cfg.timeframes||[])[0]||state.timeframe;
    state.viewKey=null;state.defaultViewRange=null;state.bundle=null;state.lastFullLoadAt=0;state.refreshWarning=null;updateSelectionState();syncVolumeLayer();
    const q=new URLSearchParams(location.search);q.set('symbol',state.symbol);q.set('tf',state.timeframe);q.set('tpl',state.template);if(state.template==='combined')q.set('view',state.viewMode);else q.delete('view');if(state.snapshot)q.set('snapshot','1');
    history.replaceState(null,'',location.pathname+'?'+q.toString());refresh(true,{cancelPrevious:true});
  }

  async function downloadPng(){
    if(!state.model)return;
    $('downloadBtn').disabled=true;
    try{
      const cfg=templateConfig();
      await X.exportBoard({
        chart:state.chart,model:state.model,info:$('infoLine').textContent,rows:state.model.tableRows,
        filename:state.symbol+(state.template==='quarter'?'-quarter':'')+'-'+state.timeframe+'.png',priceFormatter:fmtPrice,
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
    state.template=['quarter','combined'].includes(q.get('tpl'))?q.get('tpl'):(q.get('view')==='recent'?'combined':'quarter');
    state.snapshot=q.get('snapshot')==='1';
    if(state.snapshot)document.body.classList.add('snapshot');
    await loadRules();
    const cfg=templateConfig(),requestedTf=['4h','1h','1d'].includes(q.get('tf'))?q.get('tf'):null;
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
      chartInfo:()=>({line1:$('chartInfo1').textContent,line2:$('chartInfo2').textContent,countdown:$('closeCountdown').style.display==='none'?'':$('closeCountdown').textContent,watermark:symbolMeta().displayName+', '+tfLabel(state.timeframe),watermarkColor:WATERMARK_COLOR})
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
