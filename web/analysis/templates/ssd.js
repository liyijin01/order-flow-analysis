(function(global){
  'use strict';
  const registry=global.OrderFlowTemplates=global.OrderFlowTemplates||{};

  function businessDay(date){
    const [year,month,day]=String(date).split('-').map(Number);
    return{year,month,day};
  }
  function finiteNumber(value){
    return value!==null&&value!==undefined&&Number.isFinite(Number(value));
  }
  function visibleLevels(levels,minimum,maximum,padding){
    const pad=Number(padding)||0;
    return(levels||[]).filter(level=>
      finiteNumber(level.price)&&Number(level.price)>=minimum-pad&&Number(level.price)<=maximum+pad
    );
  }
  function nearestLevels(levels,value){
    const ordered=(levels||[]).filter(x=>finiteNumber(x.price)).slice()
      .sort((a,b)=>Number(a.price)-Number(b.price));
    const above=ordered.find(x=>Number(x.price)>value)||null;
    const below=ordered.slice().reverse().find(x=>Number(x.price)<=value)||null;
    return{above,below};
  }
  function buildMacro({payload,rules}){
    const ratio=Number(payload&&payload.calibration&&payload.calibration.ratio);
    if(!Number.isFinite(ratio)||ratio<=0)throw new Error('Stablecoin calibration unavailable');
    const points=(payload.points||[])
      .filter(x=>/^\d{4}-\d\d-\d\d$/.test(String(x.date))&&finiteNumber(x.raw)&&Number(x.total)>0)
      .map(p=>({
        date:String(p.date),time:businessDay(p.date),
        value:Number(p.raw)/ratio,raw:Number(p.raw),
        total:Number(p.total),missingCoins:Number(p.missingCoins)||0
      })).sort((a,b)=>a.date.localeCompare(b.date));
    if(!points.length)throw new Error('Stablecoin series unavailable');
    const last=points[points.length-1],prev=points[points.length-2]||last;
    let min=Infinity,max=-Infinity; for(const p of points){min=Math.min(min,p.value);max=Math.max(max,p.value);}
    const manualLevels=(rules.ssd&&rules.ssd.manualLevels)||[];
    const levels=visibleLevels(manualLevels,min,max,rules.ssd&&rules.ssd.visiblePadPp);
    const near=nearestLevels(manualLevels,last.value);
    return{
      points,levels,manualLevels,
      current:last.value,raw:last.raw,ratio,
      delta:last.value-prev.value,
      date:last.date,last,
      previous:prev,
      above:near.above,below:near.below,
      source:String(payload.source||'CoinGecko Demo API'),
      generatedAt:payload.generatedAt||null,
      min,max,
      cutoffUtc:last.date+'T00:00:00Z',
      display:points,
      regions:[],curves:[{id:'ssd',points:points.map(p=>({time:p.date,value:p.value}))}],
      tableRows:[],profiles:[],volume:null,
    };
  }
  function manifestValues({model}){
    if(!model||!Number.isFinite(model.current))return null;
    const selected=x=>x?{price:Number(x.price),label:x.label}:null;
    return{
      date:model.date,value:model.current,raw:model.raw,ratio:model.ratio,
      above:selected(model.above),below:selected(model.below),
      levelSource:'manual · KBeast 2026-10-05'
    };
  }
  registry.ssd={dataSource:'macro/ssd',needs:()=>({}),buildMacro,manifestValues,
    businessDay,visibleLevels,nearestLevels};
})(typeof globalThis!=='undefined'?globalThis:window);
