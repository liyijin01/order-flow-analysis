(function(global){
  'use strict';
  const $=id=>document.getElementById(id);
  const utcDay=seconds=>new Date(Number(seconds)*1000).toISOString().slice(0,10);
  const sign=(v,decimals=2)=>{
    const x=Number(v),magnitude=Math.abs(x).toFixed(decimals);
    return(x<0?'−':'+')+magnitude;
  };
  const pct=v=>Number(v).toFixed(3)+'%';
  function setDataWarning(model,snapshot){
    const el=$('staleData');
    if(!el)return;
    el.style.display='none';el.textContent='';
    if(snapshot)return;
    const updated=Date.parse(model.generatedAt||'');
    if(!Number.isFinite(updated)){
      el.textContent='稳定币数据尚未更新';el.style.display='';return;
    }
    const hours=Math.floor(Math.max(0,Date.now()-updated)/3600000);
    if(hours>36){
      el.textContent='稳定币数据已 '+hours+' 小时未更新';el.style.display='';
    }
  }

  async function mount(ctx){
    const {state,config,template,L,D}=ctx,root=$('analysisChart');
    const dataPath='analysis/'+config.dataSource+'.json';
    $('status').textContent='Loading CoinGecko dominance…';
    let payload;
    try{
      const response=await fetch(dataPath,{cache:'no-store'});
      if(!response.ok)throw new Error('SSD JSON HTTP '+response.status);
      payload=await response.json();
    }catch(error){
      $('status').textContent='SSD 数据不可用：'+String(error.message||error);
      $('status').classList.add('error');
      return;
    }
    let model;
    try{model=template.buildMacro({payload,rules:state.rules,config});}
    catch(error){
      $('status').textContent='SSD 数据不可用：'+String(error.message||error);
      $('status').classList.add('error');
      return;
    }
    state.model=model;
    state.bundle={macro:payload,generatedAt:payload.generatedAt,series:{},errors:{}};
    const chart=L.createChart(root,{
      width:root.clientWidth,height:root.clientHeight,
      layout:{background:{type:'solid',color:'#1b2130'},textColor:'#aeb7c8',
        attributionLogo:true,panes:{separatorColor:'rgba(255,255,255,.10)'}},
      grid:{vertLines:{color:'rgba(255,255,255,.055)'},
        horzLines:{color:'rgba(255,255,255,.055)'}},
      rightPriceScale:{visible:true,borderColor:'rgba(255,255,255,.14)'},
      leftPriceScale:{visible:false,borderColor:'rgba(255,255,255,.14)'},
      timeScale:{borderColor:'rgba(255,255,255,.14)',rightOffset:10,timeVisible:false},
      localization:{locale:'ja-JP',priceFormatter:pct},
      crosshair:{mode:L.CrosshairMode.Normal}
    });
    const line=chart.addSeries(L.LineSeries,{
      color:'#eceff4',lineWidth:1.5,lastValueVisible:true,priceLineVisible:false,
      crosshairMarkerVisible:true,crosshairMarkerRadius:3,
      priceFormat:{type:'custom',formatter:pct,minMove:.001},
      priceScaleId:'right'
    });
    line.setData(model.points.map(p=>({time:p.time,value:p.value})));
    const priceLines=[];
    for(const level of model.levels){
      const p=line.createPriceLine({
        price:Number(level.price),color:level.color,lineWidth:Number(level.width)||1,
        lineStyle:level.style==='dashed'?L.LineStyle.Dashed:L.LineStyle.Solid,
        axisLabelVisible:true,title:String(level.label),axisLabelColor:level.color,
        axisLabelTextColor:'#1b2130'
      });
      priceLines.push(p);
    }
    const rightFraction=Number(config.rightMarginPct||30)/100;
    const showAll=()=>{
      const n=model.points.length;
      const from=0,to=Math.max(1,n-1)/(1-rightFraction);
      chart.timeScale().setVisibleLogicalRange({from,to});
    };
    showAll();
    if(L.createTextWatermark)L.createTextWatermark(chart.panes()[0],{
      horzAlign:'center',vertAlign:'center',
      lines:[{text:'USDT.D+USDC.D+DAI.D, 1天',
        color:'rgba(196,140,60,.30)',fontSize:40,fontStyle:'bold'}]
    });
    let bitcoin=null,binanceRequests=0;
    if(new URLSearchParams(location.search).get('overlay')==='btc'){
      binanceRequests++;
      try{
        const bars=await D.fetchHistory('BTCUSDT','1d',Math.min(1000,Math.max(30,model.points.length+2)));
        bitcoin=chart.addSeries(L.LineSeries,{
          color:'rgba(185,190,200,.7)',lineWidth:1,priceScaleId:'left',
          priceLineVisible:false,lastValueVisible:false,
          crosshairMarkerVisible:false
        });
        const valid=new Set(model.points.map(p=>p.date));
        bitcoin.setData(bars.map(b=>({
          date:utcDay(b.time),close:Number(b.close)
        })).filter(b=>valid.has(b.date)&&Number.isFinite(b.close))
          .map(b=>({time:template.businessDay(b.date),value:b.close})));
        chart.priceScale('left').applyOptions({visible:true,invertScale:true,
          borderColor:'rgba(255,255,255,.14)'});
      }catch(error){
        console.warn('BTC overlay unavailable');
      }
    }
    const panel=$('analysisLegend'),table=document.querySelector('.table-wrap');
    if(panel)panel.style.display='none';
    if(table)table.style.display='none';
    $('closeCountdown').style.display='none';
    const symbolButton=document.querySelector('[data-symbol]');
    if(symbolButton&&symbolButton.parentElement)symbolButton.parentElement.style.display='none';
    const tfs=document.querySelectorAll('[data-tf]');
    tfs.forEach(button=>{
      const active=button.dataset.tf===state.timeframe;
      button.style.display=active?'':'none';
      button.disabled=!active;
      button.classList.toggle('active',active);
    });
    document.querySelectorAll('[data-tpl]').forEach(button=>
      button.classList.toggle('active',button.dataset.tpl===state.template)
    );
    $('boardTitle').textContent='USDT.D+USDC.D+DAI.D · 1天';
    $('chartInfo1').textContent='USDT.D+USDC.D+DAI.D, 1天';
    function updateInfo(point){
      const selected=point||model.last;
      const near=template.nearestLevels(model.manualLevels,selected.value);
      const fmtNear=(label,level)=>{
        if(!level)return '  ·  '+label+' —';
        return '  ·  '+label+' '+pct(level.price)+' ('+sign(Number(level.price)-selected.value)+'pp)';
      };
      const index=model.points.findIndex(p=>p.date===selected.date);
      const prior=index>0?model.points[index-1]:selected;
      $('chartInfo2').textContent='Stablecoin dominance (top-125, TV-calibrated)  '+
        pct(selected.value)+'  raw '+pct(selected.raw)+'  ·  Δ1d '+sign(selected.value-prior.value,3)+'pp'+
        fmtNear('Above',near.above)+fmtNear('Below',near.below);
    }
    updateInfo(model.last);
    chart.subscribeCrosshairMove(event=>{
      if(!event||!event.time){updateInfo(model.last);return;}
      const point=model.points.find(p=>p.time.year===event.time.year&&
        p.time.month===event.time.month&&p.time.day===event.time.day);
      updateInfo(point||model.last);
    });
    $('infoLine').textContent='USDT.D+USDC.D+DAI.D · 1天 · '+pct(model.current)+
      ' · raw '+pct(model.raw)+' · '+model.date;
    $('cutoff').textContent='CoinGecko · UTC 日度 · '+model.date;
    const foot=document.querySelector('.capture-footer span:first-child');
    if(foot){
      foot.textContent='';
      const a=document.createElement('a');
      a.href='https://www.coingecko.com/';a.target='_blank';a.rel='noopener noreferrer';
      a.textContent='Data: CoinGecko';foot.appendChild(a);
    }
    const meta=document.querySelector('.capture-meta');
    if(meta)meta.textContent='STABLECOIN DOMINANCE';
    setDataWarning(model,state.snapshot);
    state.chart=chart;state.line=line;state.btcOverlay=bitcoin;
    $('status').textContent='Loaded '+model.points.length+' daily dominance points · '+model.levels.length+' visible key levels';
    $('status').classList.remove('error');
    new ResizeObserver(()=>chart.resize(root.clientWidth,root.clientHeight)).observe(root);
    document.querySelectorAll('[data-tpl]').forEach(button=>button.addEventListener('click',()=>{
      if(button.dataset.tpl===state.template)return;
      const params=new URLSearchParams(location.search);
      params.set('tpl',button.dataset.tpl);
      params.delete('overlay');
      if(state.snapshot)params.set('snapshot','1');
      const next=state.rules.templates[button.dataset.tpl];
      if(next)params.set('tf',next.defaultTimeframe||'1h');
      location.assign(location.pathname+'?'+params.toString());
    }));
    $('resetViewBtn').addEventListener('click',showAll);
    $('downloadBtn').addEventListener('click',()=>{
      const canvas=chart.takeScreenshot();
      canvas.toBlob(blob=>{
        if(!blob)return;
        const url=URL.createObjectURL(blob);
        const anchor=document.createElement('a');
        anchor.href=url;anchor.download='SSD-1d.png';anchor.click();
        setTimeout(()=>URL.revokeObjectURL(url),2000);
      });
    });
    global.__analysisDebug={
      state,get model(){return state.model;},template:()=>state.template,
      view:()=>({range:chart.timeScale().getVisibleLogicalRange()}),
      windowSpec:()=>({mode:'full'}),axisLabels:()=>[],
      chartInfo:()=>({line1:$('chartInfo1').textContent,
        line2:$('chartInfo2').textContent,countdown:'',
        watermark:'USDT.D+USDC.D+DAI.D, 1天'}),
      candleStyle:()=>({visible:false,upColor:null,downColor:null}),
      binanceRequests:()=>binanceRequests,
      lines:()=>model.levels,
      refresh:async()=>mount(ctx)
    };
  }
  global.OrderFlowMacroRuntime={mount};
})(typeof globalThis!=='undefined'?globalThis:window);
