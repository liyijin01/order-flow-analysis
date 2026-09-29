(function(global){
  'use strict';

  function nextFrame(){return new Promise(resolve=>requestAnimationFrame(()=>resolve()));}
  function rangesClose(a,b,tolerance){
    if(!a||!b)return false;const t=Number(tolerance)||0;
    return Math.abs(Number(a.from)-Number(b.from))<=t&&Math.abs(Number(a.to)-Number(b.to))<=t;
  }

  function defaultWindow(chart,rules,timeframe,count){
    const baseVisible=Math.max(1,Number(rules.display.visibleBars&&rules.display.visibleBars[timeframe])||count);
    const baseOffset=Math.max(0,Number(rules.display.rightOffset)||30);
    const ratio=baseOffset/baseVisible;
    const minSpacing=Math.max(1,Number(rules.display.minBarSpacingPx)||5);
    const paneWidth=chart&&chart.timeScale?Number(chart.timeScale().width()):0;
    const fit=paneWidth>0?Math.floor(paneWidth/(minSpacing*(1+ratio))):baseVisible;
    const visible=Math.min(count,Math.max(30,Math.min(baseVisible,Math.max(1,fit))));
    const rightOffsetBars=Math.max(3,Math.round(visible*ratio));
    return{visible,rightOffsetBars,range:{from:Math.max(0,count-visible),to:Math.max(0,count-1)+rightOffsetBars}};
  }

  function applyDefaultView(chart,rules,timeframe,count,state){
    const spec=defaultWindow(chart,rules,timeframe,count);
    chart.timeScale().applyOptions({rightOffset:spec.rightOffsetBars});
    chart.timeScale().setVisibleLogicalRange(spec.range);
    if(state)state.defaultViewRange={from:spec.range.from,to:spec.range.to};
    return spec;
  }

  async function runRefresh(state,forceFull,options,hooks){
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
        if(hooks.before)await hooks.before(token,controller.signal);
        if(controller.signal.aborted)return null;
        const result=await hooks.load(token,!!forceFull,controller.signal);
        if(token!==state.loadToken||controller.signal.aborted)return null;
        return hooks.apply?await hooks.apply(result,token,controller.signal):result;
      }catch(e){
        if(controller.signal.aborted||(e&&e.name==='AbortError'))return null;
        if(hooks.error)return hooks.error(e,token);
        throw e;
      }
    })();
    state.inFlight=task;
    try{return await task;}
    finally{
      if(state.inFlight===task)state.inFlight=null;
      if(state.abortController===controller)state.abortController=null;
    }
  }

  function startRefreshLoop(state,refreshMs,refresh){
    const ms=Math.max(1000,Number(refreshMs)||60000);
    state.refreshTimer=setInterval(()=>refresh(false,{scheduled:true}),ms);
    const onVisibility=()=>{
      if(document.hidden||state.inFlight)return;
      if(Date.now()-Number(state.lastSuccessAt||0)>=ms)refresh(false,{scheduled:true});
    };
    document.addEventListener('visibilitychange',onVisibility);
    return()=>{clearInterval(state.refreshTimer);document.removeEventListener('visibilitychange',onVisibility);};
  }

  function resetView(seriesList,chart,range){
    for(const series of seriesList||[])if(series&&series.priceScale)series.priceScale().applyOptions({autoScale:true});
    if(chart&&range)chart.timeScale().setVisibleLogicalRange(range);
  }

  function scheduleResize(state,wasDefault,beforeRange,chart,settleDefault){
    const token=++state.resizeToken;
    (async()=>{
      await nextFrame();await nextFrame();
      if(token!==state.resizeToken)return;
      if(!wasDefault){
        if(beforeRange)chart.timeScale().setVisibleLogicalRange({from:Number(beforeRange.from),to:Number(beforeRange.to)});
        return;
      }
      const task=settleDefault(()=>token===state.resizeToken);
      state.resizeSettle=task;
      try{await task;}
      finally{if(state.resizeSettle===task)state.resizeSettle=null;}
    })();
  }

  global.OrderFlowBoardRuntime={nextFrame,rangesClose,defaultWindow,applyDefaultView,runRefresh,startRefreshLoop,resetView,scheduleResize};
})(typeof globalThis!=='undefined'?globalThis:window);
