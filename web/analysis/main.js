(function(){
  'use strict';

  const L=window.LightweightCharts,D=window.OrderFlowAnalysisData,E=window.OrderFlowAnalysisEngine,P=window.OrderFlowAnalysisPrimitive,X=window.OrderFlowAnalysisExport;
  const SYMBOLS=window.ORDER_FLOW_SYMBOLS||{};
  const $=id=>document.getElementById(id);
  const state={symbol:'BTCUSDT',timeframe:'4h',snapshot:false,rules:null,bundle:null,chart:null,candles:null,volume:null,vwap:null,primitive:null,loadToken:0,refreshTimer:null,model:null};

  function tfLabel(tf){return({'1h':'1小时','4h':'4小时','1d':'1天'})[tf]||tf;}
  function symbolMeta(){return SYMBOLS[state.symbol]||{displayName:state.symbol,tickSize:'0.01',ladderBin:'0.1'};}
  function pricePrecision(){
    const s=String(symbolMeta().tickSize||'0.01'),i=s.indexOf('.');return i<0?0:s.length-i-1;
  }
  function fmtPrice(v){
    const p=pricePrecision(),tick=Number(symbolMeta().tickSize)||.01,n=E.roundToTick(Number(v),tick);
    return n.toLocaleString(undefined,{minimumFractionDigits:p,maximumFractionDigits:p});
  }
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
  function sourceRows(payload){
    const out=[],current=payload.current;
    for(const r of payload.regions){
      out.push({
        type:r.tableType||r.label,low:r.bottom,high:r.top,distance:distancePct(current,r.bottom,r.top),
        status:r.tested?'已测试':'未测试',period:r.period||'',source:r.source||'exact',missing:false
      });
    }
    for(const l of payload.levels.filter(x=>x.kind==='npoc')){
      out.push({type:l.label,low:l.price,high:l.price,distance:Math.abs(l.price-current)/current*100,status:'未回补',period:l.period||'',source:l.source||'exact',missing:false});
    }
    for(const m of payload.missing||[])out.push({type:m.type,low:null,high:null,distance:null,status:'缺失',period:m.period||'',source:m.source||'',missing:true});
    out.sort((a,b)=>{
      const ap=a.high==null?-Infinity:a.high,bp=b.high==null?-Infinity:b.high;
      return bp-ap||String(a.type).localeCompare(String(b.type));
    });
    return out;
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
      upColor:'rgba(0,0,0,0)',downColor:'#d9dde6',borderUpColor:'#d9dde6',borderDownColor:'#d9dde6',wickUpColor:'#d9dde6',wickDownColor:'#d9dde6',
      priceFormat:{type:'price',precision:pricePrecision(),minMove:tick},lastValueVisible:true,priceLineVisible:false
    },0);
    const volume=chart.addSeries(L.HistogramSeries,{priceFormat:{type:'volume'},priceLineVisible:false,lastValueVisible:false},1);
    const vwap=chart.addSeries(L.LineSeries,{color:'#5cb85c',lineWidth:1,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false},0);
    const primitive=new P.AnalysisBoardPrimitive({});
    candles.attachPrimitive(primitive);
    const panes=chart.panes();if(panes[1])panes[1].setHeight(Math.max(110,Math.round(container.clientHeight*.18)));
    new ResizeObserver(()=>{chart.resize(container.clientWidth,container.clientHeight);const ps=chart.panes();if(ps[1])ps[1].setHeight(Math.max(100,Math.round(container.clientHeight*.18)));if(primitive.requestUpdate)primitive.requestUpdate();}).observe(container);
    state.chart=chart;state.candles=candles;state.volume=volume;state.vwap=vwap;state.primitive=primitive;
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

  function buildAnalysis(bundle){
    const rules=state.rules,tick=Number(symbolMeta().tickSize)||.01,counts=rules.display.bars;
    const display=(bundle.series[state.timeframe]||bundle.series.display||[]).slice(-(Number(counts[state.timeframe])||540));
    if(!display.length)throw new Error('display data missing for '+state.timeframe);
    const one=bundle.series['1h']||[],thirty=bundle.series['30m']||[],calcTf=rules.zones.calcIntervals[state.timeframe],calc=bundle.series[calcTf]||[];
    const last=display[display.length-1],current=Number(last.close);let min=Infinity,max=-Infinity;for(const b of display){if(Number(b.low)<min)min=Number(b.low);if(Number(b.high)>max)max=Number(b.high);}
    const qStart=E.utcQuarterStart(last.time),pqStart=E.previousQuarterStart(last.time),areas=[],missing=[];

    const pqBars=one.filter(b=>b.time>=pqStart&&b.time<qStart),pqStats=E.weightedStats(pqBars);
    if(pqStats&&pqBars.length&&pqBars[0].time<=pqStart+3600){
      areas.push({id:'value-pq',type:'value',scope:'PQ',bottom:pqStats.lower,top:pqStats.upper,from:qStart,
        label:'上季价值区 PQ',tableType:'价值区 PQ',period:'Q / 1h',source:'exact',tested:E.wasZoneTouched(one,qStart,pqStats.lower,pqStats.upper),
        fill:rules.colors.pqFill,border:rules.colors.pqBorder,pqVwap:pqStats.vwap});
    }else missing.push({type:'价值区 PQ',period:'Q / 1h',source:'exact'});

    const pm=pmArea(one,thirty,last.time),mStart=E.utcMonthStart(last.time);
    if(pm){
      areas.push({id:'value-pm',type:'value',scope:'PM',bottom:pm.bottom,top:pm.top,from:mStart,
        label:'上月价值区 PM'+(pm.source==='approx'?' ≈':''),tableType:'价值区 PM',period:'M / '+(pm.definition==='tpo-70'?'30m TPO':'1h'),
        source:pm.source,tested:E.wasZoneTouched(one,mStart,pm.bottom,pm.top),fill:rules.colors.pmFill,border:rules.colors.pmBorder});
    }else missing.push({type:'价值区 PM',period:'M',source:'approx'});

    const pw=E.exactProfile(bundle.profile),weekEnd=periodEndFromProfile(bundle.profile);
    if(pw&&weekEnd){
      areas.push({id:'value-pw',type:'value',scope:'PW',bottom:pw.val,top:pw.vah,from:weekEnd,
        label:'上周价值区 PW',tableType:'价值区 PW',period:'W / aggTrades',source:'exact',
        tested:E.wasZoneTouched(thirty.length?thirty:one,weekEnd,pw.val,pw.vah),fill:rules.colors.pwFill,border:rules.colors.pwBorder});
    }else missing.push({type:'价值区 PW',period:'W / aggTrades',source:'exact'});

    const visibleAreas=E.filterValueAreas(areas,min,max,rules.valueAreas.visiblePadPct,rules.valueAreas.overlapSuppressPct);

    let zones=[];
    if(calc.length){
      zones=E.selectZones(E.detectZones(calc,rules.zones),current,rules.zones).map(z=>{
        const supply=z.type==='supply',baseFill=supply?rules.colors.supplyFill:rules.colors.demandFill,border=supply?rules.colors.supplyBorder:rules.colors.demandBorder;
        return{...z,type:z.type,fill:fillAlpha(baseFill,z.tested),border,period:calcTf,source:'exact',
          label:(supply?'供应区':'需求区')+(z.tested?'·已测试':'')+' · '+calcTf.toUpperCase()+' · '+z.strength.toFixed(1)+'ATR',
          tableType:supply?'供应区':'需求区'};
      });
    }else missing.push({type:'供应/需求区',period:calcTf,source:'exact'});

    const levels=[];
    const pq=areas.find(a=>a.scope==='PQ');
    if(pq)levels.push({id:'line-pq-vwap',kind:'pq',price:pq.pqVwap,from:qStart,label:'PQ VWAP',color:rules.colors.pqVwap,style:'solid',period:'Q / 1h',source:'exact'});

    const pocCandidates=[];
    if(pw&&weekEnd&&E.isPocNaked(pw.poc,weekEnd,thirty.length?thirty:one)){
      pocCandidates.push({id:'npoc-week',kind:'npoc',price:pw.poc,from:weekEnd,label:'nPOC W',color:rules.colors.nPoc,style:'dashed',period:'W / aggTrades',source:'exact'});
    }else if(!pw){
      const wt=previousWeekTpo(thirty,last.time,tick);
      if(wt&&E.isPocNaked(wt.poc,wt.from,thirty))pocCandidates.push({id:'npoc-week-tpo',kind:'npoc',price:wt.poc,from:wt.from,label:'nPOC W ≈',color:rules.colors.nPoc,style:'dashed',period:'W / 30m TPO',source:'approx'});
    }
    const mt=previousMonthTpo(thirty,last.time,tick);
    if(mt&&E.isPocNaked(mt.poc,mt.from,thirty))pocCandidates.push({id:'npoc-month',kind:'npoc',price:mt.poc,from:mt.from,label:'nPOC M ≈',color:rules.colors.nPoc,style:'dashed',period:'M / 30m TPO',source:'approx'});
    levels.push(...E.selectNakedPocs(pocCandidates,current,rules.nakedPoc.maxCount));

    const currentVwap=E.anchoredVwapSeries(one,qStart);
    const regions=visibleAreas.concat(zones);
    return{
      symbol:state.symbol,timeframe:state.timeframe,display,last,current,regions,levels,currentVwap,missing,
      cutoffUtc:bundle.cutoffUtc||null,generatedAt:bundle.generatedAt||new Date().toISOString(),
      calcTf,bundleErrors:bundle.errors||{},tableRows:sourceRows({regions,levels,current,missing})
    };
  }

  function renderTable(model){
    const tbody=$('regionRows');tbody.textContent='';
    for(const r of model.tableRows){
      const tr=document.createElement('tr');
      const range=r.missing?'—':(r.low===r.high?fmtPrice(r.low):fmtPrice(r.low)+' – '+fmtPrice(r.high));
      const dist=r.distance==null?'—':r.distance.toFixed(2)+'%';
      for(const value of [r.type,range,dist,r.status,r.period,r.source||'—']){
        const td=document.createElement('td');td.textContent=value;tr.appendChild(td);
      }
      if(r.missing)tr.classList.add('missing');tbody.appendChild(tr);
    }
  }

  function applySeries(model){
    const candleData=model.display.map(b=>({time:D.toDisplayTime(b.time),open:b.open,high:b.high,low:b.low,close:b.close}));
    const volumeData=model.display.map(b=>({time:D.toDisplayTime(b.time),value:b.volume,color:b.close>=b.open?'rgba(230,234,242,.42)':'rgba(230,234,242,.68)'}));
    state.candles.setData(candleData);state.volume.setData(volumeData);
    const visibleStart=model.display[0]&&model.display[0].time;
    state.vwap.setData(model.currentVwap.filter(p=>visibleStart==null||p.time>=visibleStart).map(p=>({time:D.toDisplayTime(p.time),value:p.value})));
    state.primitive.setModel({
      regions:model.regions,levels:model.levels,bars:model.display,currentPrice:model.current,
      intervalSec:D.intervalSec(state.timeframe),timeOffsetSec:9*3600,axisMinGap:state.rules.axisLabels.minGapPx,
      textMinGap:state.rules.textLabels.minGapPx,textMaxShift:state.rules.textLabels.maxShiftPx,priceFormatter:fmtPrice
    });
    state.chart.timeScale().applyOptions({rightOffset:Number(state.rules.display.rightOffset)||30});
    state.chart.timeScale().fitContent();
    const panes=state.chart.panes();if(panes[1])panes[1].setHeight(Math.max(105,Math.round($('analysisChart').clientHeight*.18)));
  }

  function updateHeader(model){
    $('boardTitle').textContent=symbolMeta().displayName+' · '+tfLabel(state.timeframe);
    $('infoLine').textContent=symbolMeta().displayName+' · '+tfLabel(state.timeframe)+' · 收 '+fmtPrice(model.current)+' · 更新于 '+D.formatJst(model.last.time)+' JST';
    $('cutoff').textContent=model.cutoffUtc?'数据截止 '+String(model.cutoffUtc).slice(0,10)+' UTC':'实时 Binance USD-M · 每 60 秒刷新';
    const errs=Object.keys(model.bundleErrors||{});
    $('status').textContent='Loaded '+model.display.length+' display candles · '+model.regions.length+' regions · '+model.levels.length+' key lines'+(errs.length?' · 缺失 '+errs.join(', '):'');
    $('status').classList.toggle('error',errs.length>0);
    document.querySelectorAll('[data-symbol]').forEach(b=>b.classList.toggle('active',b.dataset.symbol===state.symbol));
    document.querySelectorAll('[data-tf]').forEach(b=>b.classList.toggle('active',b.dataset.tf===state.timeframe));
  }

  async function getBundle(token){
    const progress=$('status');
    if(state.snapshot){
      progress.textContent='Loading archived snapshot…';
      return D.loadSnapshot(state.symbol);
    }
    return D.loadLive(state.symbol,state.timeframe,p=>{
      if(token===state.loadToken)progress.textContent='Loading '+p.done+'/'+p.total+' · '+p.label;
    });
  }

  async function refresh(){
    const token=++state.loadToken;
    try{
      await loadRules();
      const bundle=await getBundle(token);if(token!==state.loadToken)return;
      state.bundle=bundle;const model=buildAnalysis(bundle);state.model=model;
      applySeries(model);renderTable(model);updateHeader(model);
    }catch(e){console.error(e);$('status').textContent='加载失败：'+String(e.message||e);$('status').classList.add('error');}
  }

  function setSelection(symbol,tf){
    if(symbol&&SYMBOLS[symbol])state.symbol=symbol;
    if(['4h','1h','1d'].includes(tf))state.timeframe=tf;
    const q=new URLSearchParams(location.search);q.set('symbol',state.symbol);q.set('tf',state.timeframe);if(state.snapshot)q.set('snapshot','1');
    history.replaceState(null,'',location.pathname+'?'+q.toString());refresh();
  }

  async function downloadPng(){
    if(!state.model)return;
    $('downloadBtn').disabled=true;
    try{
      await X.exportBoard({
        chart:state.chart,model:state.model,info:$('infoLine').textContent,rows:state.model.tableRows,
        filename:state.symbol+'-'+state.timeframe+'.png',priceFormatter:fmtPrice
      });
    }finally{$('downloadBtn').disabled=false;}
  }

  async function init(){
    const q=new URLSearchParams(location.search);
    state.symbol=SYMBOLS[q.get('symbol')]?q.get('symbol'):'BTCUSDT';
    state.timeframe=['4h','1h','1d'].includes(q.get('tf'))?q.get('tf'):'4h';
    state.snapshot=q.get('snapshot')==='1';
    if(state.snapshot)document.body.classList.add('snapshot');
    await loadRules();createChart();
    document.querySelectorAll('[data-symbol]').forEach(b=>b.addEventListener('click',()=>setSelection(b.dataset.symbol,state.timeframe)));
    document.querySelectorAll('[data-tf]').forEach(b=>b.addEventListener('click',()=>setSelection(state.symbol,b.dataset.tf)));
    $('downloadBtn').addEventListener('click',downloadPng);
    window.__analysisDebug={
      state,get model(){return state.model;},refresh,
      axisLabels:()=>state.primitive?state.primitive.debugAxisLabels():[],
      priceCoordinate:p=>state.candles?state.candles.priceToCoordinate(Number(p)):null,
      volumeFormat:()=>state.volume?state.volume.options().priceFormat:null
    };
    await refresh();
    if(!state.snapshot)state.refreshTimer=setInterval(refresh,Number(state.rules.display.refreshSeconds||60)*1000);
  }
  init();
})();
