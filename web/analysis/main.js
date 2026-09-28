(function(){
  'use strict';

  const L=window.LightweightCharts,D=window.OrderFlowAnalysisData,E=window.OrderFlowAnalysisEngine,P=window.OrderFlowAnalysisPrimitive,X=window.OrderFlowAnalysisExport;
  const SYMBOLS=window.ORDER_FLOW_SYMBOLS||{};
  const $=id=>document.getElementById(id);
  const state={
    symbol:'BTCUSDT',timeframe:'4h',snapshot:false,rules:null,bundle:null,chart:null,candles:null,volume:null,vwap:null,primitive:null,
    loadToken:0,refreshTimer:null,model:null,viewKey:null,lastDisplayCount:0,lastFullLoadAt:0,refreshWarning:null,
    inFlight:null,abortController:null,lastSuccessAt:0,defaultViewRange:null
  };

  function tfLabel(tf){return({'1h':'1小时','4h':'4小时','1d':'1天'})[tf]||tf;}
  function symbolMeta(){return SYMBOLS[state.symbol]||{displayName:state.symbol,tickSize:'0.01',ladderBin:'0.1'};}
  function pricePrecision(){const s=String(symbolMeta().tickSize||'0.01'),i=s.indexOf('.');return i<0?0:s.length-i-1;}
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
  function rangesClose(a,b,tolerance){
    if(!a||!b)return false;const t=Number(tolerance)||0;
    return Math.abs(Number(a.from)-Number(b.from))<=t&&Math.abs(Number(a.to)-Number(b.to))<=t;
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
    for(const l of payload.levels){
      let status=l.kind==='npoc'?'未回补':'有效';if(l.offView)status+='（图外）';
      out.push({type:l.label,low:l.price,high:l.price,distance:Math.abs(l.price-current)/current*100,status,period:l.period||'',source:l.source||'exact',missing:false});
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
    state.chart=chart;state.candles=candles;state.volume=volume;state.vwap=vwap;state.primitive=primitive;
    new ResizeObserver(()=>{
      const before=chart.timeScale().getVisibleLogicalRange();
      const wasDefault=rangesClose(before,state.defaultViewRange,.5);
      chart.resize(container.clientWidth,container.clientHeight);
      const ps=chart.panes();if(ps[1])ps[1].setHeight(Math.max(100,Math.round(container.clientHeight*.18)));
      if(wasDefault&&state.model&&state.bundle){
        const rebuilt=buildAnalysis(state.bundle);state.model=rebuilt;
        applySeries(rebuilt);renderTable(rebuilt);updateHeader(rebuilt);
        applyDefaultView(rebuilt.display.length);
      }
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

  function buildAnalysis(bundle){
    const rules=state.rules,tick=Number(symbolMeta().tickSize)||.01,counts=rules.display.bars;
    const display=(bundle.series[state.timeframe]||bundle.series.display||[]).slice(-(Number(counts[state.timeframe])||540));
    if(!display.length)throw new Error('display data missing for '+state.timeframe);
    const visibleN=defaultWindow(display.length).visible;
    const viewBars=display.slice(-visibleN),view=extrema(viewBars);
    const one=bundle.series['1h']||[],thirty=bundle.series['30m']||[],calcTf=rules.zones.calcIntervals[state.timeframe],calc=bundle.series[calcTf]||[];
    const last=display[display.length-1],current=Number(last.close),qStart=E.utcQuarterStart(last.time),pqStart=E.previousQuarterStart(last.time),areas=[],missing=[];

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
    if(pq)allLevels.push({id:'line-pq-vwap',kind:'pq',price:pq.pqVwap,from:qStart,label:'PQ VWAP',color:rules.colors.pqVwap,style:'solid',period:'Q / 1h',source:'exact'});

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
    const drawnLevelIds=new Set(allLevels.filter(l=>E.inPriceView(l.price,view.min,view.max,linePad)).map(l=>l.id));

    const allRegions=allAreas.concat(selectedZones).map(r=>({...r,offView:r.type==='value'?!drawnAreaIds.has(r.id):!drawnZoneIds.has(r.id)}));
    const levelsForTable=allLevels.map(l=>({...l,offView:!drawnLevelIds.has(l.id)}));
    const regions=allRegions.filter(r=>!r.offView),levels=levelsForTable.filter(l=>!l.offView);

    const rawCurrentVwap=E.anchoredVwapSeries(one,qStart);
    const currentVwap=E.alignSeriesToBars(rawCurrentVwap,display,D.intervalSec(state.timeframe));
    const lastClosed=closedCalc[closedCalc.length-1];
    const calcLastClosedUtc=lastClosed?new Date(Number(lastClosed.closeTime)+1).toISOString():null;
    return{
      symbol:state.symbol,timeframe:state.timeframe,display,last,current,regions,levels,currentVwap,missing,
      allRegions,allLevels:levelsForTable,viewMin:view.min,viewMax:view.max,visibleBars:visibleN,
      cutoffUtc:bundle.cutoffUtc||null,generatedAt:bundle.generatedAt||new Date().toISOString(),
      calcTf,calcLastClosedUtc,bundleErrors:bundle.errors||{},
      tableRows:sourceRows({regions:allRegions,levels:levelsForTable,current,missing})
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

  function defaultWindow(count){
    const baseVisible=Math.max(1,Number(state.rules.display.visibleBars&&state.rules.display.visibleBars[state.timeframe])||count);
    const baseOffset=Math.max(0,Number(state.rules.display.rightOffset)||30);
    const ratio=baseOffset/baseVisible;
    const minSpacing=Math.max(1,Number(state.rules.display.minBarSpacingPx)||5);
    const paneWidth=state.chart&&state.chart.timeScale?Number(state.chart.timeScale().width()):0;
    const fit=paneWidth>0?Math.floor(paneWidth/(minSpacing*(1+ratio))):baseVisible;
    const visible=Math.min(count,Math.max(30,Math.min(baseVisible,Math.max(1,fit))));
    const rightOffsetBars=Math.max(3,Math.round(visible*ratio));
    return{
      visible,rightOffsetBars,
      range:{from:Math.max(0,count-visible),to:Math.max(0,count-1)+rightOffsetBars}
    };
  }

  function defaultVisibleRange(count){return defaultWindow(count).range;}

  function applyDefaultView(count){
    const spec=defaultWindow(count);
    state.chart.timeScale().applyOptions({rightOffset:spec.rightOffsetBars});
    state.chart.timeScale().setVisibleLogicalRange(spec.range);
    state.defaultViewRange={from:spec.range.from,to:spec.range.to};
    return spec;
  }

  function nextFrame(){return new Promise(resolve=>requestAnimationFrame(()=>resolve()));}

  async function settleDefaultWindow(bundle){
    if(!state.model||!bundle)return state.model;
    let model=state.model,stable=0,lastWidth=-1;
    for(let i=0;i<10&&stable<3;i++){
      await nextFrame();
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

  function resetView(){
    if(!state.model)return;
    state.candles.priceScale().applyOptions({autoScale:true});
    state.volume.priceScale().applyOptions({autoScale:true});
    applyDefaultView(state.model.display.length);
  }

  function applySeries(model){
    const key=state.symbol+'|'+state.timeframe,sameView=state.viewKey===key;
    const oldRange=sameView?state.chart.timeScale().getVisibleLogicalRange():null;
    const oldWasDefault=sameView&&rangesClose(oldRange,state.defaultViewRange,.5);
    const oldCount=state.lastDisplayCount||0;
    const followedRight=!!(oldRange&&Number(oldRange.to)>=oldCount-1);
    if(!sameView){
      state.candles.priceScale().applyOptions({autoScale:true});
      state.volume.priceScale().applyOptions({autoScale:true});
      const tick=Number(symbolMeta().tickSize)||.01;
      const fmt={type:'price',precision:pricePrecision(),minMove:tick};
      state.candles.applyOptions({priceFormat:fmt});
      state.vwap.applyOptions({priceFormat:fmt});
    }
    const candleData=model.display.map(b=>({time:D.toDisplayTime(b.time),open:b.open,high:b.high,low:b.low,close:b.close}));
    const volumeData=model.display.map(b=>({time:D.toDisplayTime(b.time),value:b.volume,color:b.close>=b.open?'rgba(230,234,242,.42)':'rgba(230,234,242,.68)'}));
    state.candles.setData(candleData);state.volume.setData(volumeData);
    state.vwap.setData(model.currentVwap.map(p=>({time:D.toDisplayTime(p.time),value:p.value})));
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
  }

  function updateSelectionState(){
    $('boardTitle').textContent=symbolMeta().displayName+' · '+tfLabel(state.timeframe);
    document.querySelectorAll('[data-symbol]').forEach(b=>b.classList.toggle('active',b.dataset.symbol===state.symbol));
    document.querySelectorAll('[data-tf]').forEach(b=>b.classList.toggle('active',b.dataset.tf===state.timeframe));
  }

  function updateHeader(model){
    updateSelectionState();
    if(state.snapshot){
      $('infoLine').textContent=symbolMeta().displayName+' · '+tfLabel(state.timeframe)+' · 收 '+fmtPrice(model.current)+' · 数据截至 '+formatCutoffJst(model.cutoffUtc);
    }else{
      $('infoLine').textContent=symbolMeta().displayName+' · '+tfLabel(state.timeframe)+' · 收 '+fmtPrice(model.current)+' · 最后刷新 '+formatJstClock(state.lastSuccessAt)+' JST';
    }
    $('cutoff').textContent=model.cutoffUtc?'数据截止 '+String(model.cutoffUtc).slice(0,10)+' UTC':'实时 Binance USD-M · 每 '+String(Number(state.rules.display.refreshSeconds)||60)+' 秒刷新';
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
    const opts=options||{};
    if(opts.scheduled&&document.hidden)return null;
    if(state.inFlight){
      if(opts.cancelPrevious&&state.abortController)state.abortController.abort();
      else return state.inFlight;
    }
    const controller=new AbortController(),token=++state.loadToken;
    state.abortController=controller;
    const task=(async()=>{
      try{
        await loadRules();
        if(controller.signal.aborted)return null;
        const result=await getBundle(token,!!forceFull,controller.signal);
        if(token!==state.loadToken||controller.signal.aborted)return null;
        state.bundle=result.bundle;
        state.refreshWarning=result.failures.length?result.failures.map(x=>x.interval).join(', ')+' 更新失败':null;
        let model=buildAnalysis(result.bundle);state.model=model;
        applySeries(model);renderTable(model);
        model=await settleDefaultWindow(result.bundle);
        state.lastSuccessAt=Date.now();
        updateHeader(model);
        return model;
      }catch(e){
        if(controller.signal.aborted||(e&&e.name==='AbortError'))return null;
        console.error(e);
        if(state.model){
          state.refreshWarning=String(e.message||e);
          updateHeader(state.model);
        }else{
          $('status').textContent='加载失败：'+String(e.message||e);$('status').classList.add('error');
        }
        return null;
      }
    })();
    state.inFlight=task;
    try{return await task;}
    finally{
      if(state.inFlight===task)state.inFlight=null;
      if(state.abortController===controller)state.abortController=null;
    }
  }

  function setSelection(symbol,tf){
    if(symbol&&SYMBOLS[symbol])state.symbol=symbol;
    if(['4h','1h','1d'].includes(tf))state.timeframe=tf;
    state.bundle=null;state.lastFullLoadAt=0;state.refreshWarning=null;
    updateSelectionState();
    $('infoLine').textContent=symbolMeta().displayName+' · '+tfLabel(state.timeframe)+' · 加载中…';
    $('status').textContent='Loading…';$('status').classList.remove('error');
    const q=new URLSearchParams(location.search);q.set('symbol',state.symbol);q.set('tf',state.timeframe);if(state.snapshot)q.set('snapshot','1');
    history.replaceState(null,'',location.pathname+'?'+q.toString());refresh(true,{cancelPrevious:true});
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
    state.timeframe=['4h','1h','1d'].includes(q.get('tf'))?q.get('tf'):'4h';
    state.snapshot=q.get('snapshot')==='1';
    if(state.snapshot)document.body.classList.add('snapshot');
    await loadRules();createChart();
    document.querySelectorAll('[data-symbol]').forEach(b=>b.addEventListener('click',()=>setSelection(b.dataset.symbol,state.timeframe)));
    document.querySelectorAll('[data-tf]').forEach(b=>b.addEventListener('click',()=>setSelection(state.symbol,b.dataset.tf)));
    $('resetViewBtn').addEventListener('click',resetView);
    $('downloadBtn').addEventListener('click',downloadPng);
    window.__analysisDebug={
      state,get model(){return state.model;},refresh:(forceFull)=>refresh(!!forceFull),
      axisLabels:()=>state.primitive?state.primitive.debugAxisLabels():[],
      priceCoordinate:p=>state.candles?state.candles.priceToCoordinate(Number(p)):null,
      volumeFormat:()=>state.volume?state.volume.options().priceFormat:null,
      view:debugView,
      mainPaneHeight:()=>{const p=state.chart&&state.chart.panes&&state.chart.panes()[0];return p&&typeof p.getHeight==='function'?p.getHeight():Math.round($('analysisChart').clientHeight*.82);},
      candleTimes:()=>state.model?state.model.display.map(x=>x.time):[],
      vwapTimes:()=>state.model?state.model.currentVwap.map(x=>x.time):[]
    };
    await refresh(true);
    if(!state.snapshot){
      const refreshMs=Number(state.rules.display.refreshSeconds||60)*1000;
      state.refreshTimer=setInterval(()=>refresh(false,{scheduled:true}),refreshMs);
      document.addEventListener('visibilitychange',()=>{
        if(document.hidden||state.inFlight)return;
        if(Date.now()-state.lastSuccessAt>=refreshMs)refresh(false,{scheduled:true});
      });
    }
  }
  init();
})();
