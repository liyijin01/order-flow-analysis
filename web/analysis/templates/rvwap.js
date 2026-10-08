(function(global){
  'use strict';

  const registry=global.OrderFlowTemplates=global.OrderFlowTemplates||{};

  const I=global.OrderFlowIndicators;
  function yearVwapSegments(fourHour,display){
    if(!fourHour.length||!display.length)return[];
    const years=[];for(const b of display){const y=new Date(Number(b.time)*1000).getUTCFullYear();if(!years.includes(y))years.push(y);}
    const out=[];
    for(const year of years){
      const start=Date.UTC(year,0,1)/1000,end=Date.UTC(year+1,0,1)/1000;
      const calc=fourHour.filter(b=>Number(b.time)>=start&&Number(b.time)<end);if(!calc.length)continue;
      const raw=I.anchoredVwap(calc,start,1),allowed=new Set(display.filter(b=>Number(b.time)>=start&&Number(b.time)<end).map(b=>Number(b.time)));
      const points=raw.filter(p=>allowed.has(Number(p.time))).map(p=>({time:Number(p.time),vwap:p.vwap,upper:p.upper,lower:p.lower}));
      if(points.length)out.push({year,start,end,points,final:points[points.length-1]});
    }
    return out;
  }


  registry.rvwap={
    build(ctx){
      const {state,I,bundle,display,layerEnabled}=ctx;
      if(!layerEnabled('rvwap')||state.timeframe!=='4h'||!display.length){
        return{curves:[],rolling:{},yearSegments:[]};
      }
      const four=bundle.series['4h']||[];
      const cfg=state.rules.rvwap||{};
      const allowed=new Set(display.map(b=>Number(b.time)));
      const curves=[];
      const rolling={};
      for(const days of cfg.windowsDays||[30,60,90,365]){
        const points=I.rollingVwap(four,Number(days)*86400).filter(p=>p.value!=null&&allowed.has(Number(p.time)));
        rolling[String(days)]=points;
        curves.push({
          id:'rvwap-'+days,
          label:String(days)+'D RVWAP',
          points,
          color:cfg.color||'#4caf50',
          width:1.5,
          underlay:cfg.underlay||'rgba(190,196,208,.10)',
          underlayWidth:6,
          labelColor:cfg.labelColor||'#aeb7c8'
        });
      }
      const yearSegments=yearVwapSegments(four,display);
      for(let i=0;i<yearSegments.length;i++){
        const seg=yearSegments[i];
        const last=i===yearSegments.length-1;
        curves.push({
          id:'y-vwap-'+seg.year,
          label:last?'Y VWAP':'',
          points:seg.points.map(p=>({time:p.time,value:p.vwap})),
          color:cfg.yearVwap||'#e8d44d',
          width:1.5,
          underlay:cfg.underlay||'rgba(190,196,208,.10)',
          underlayWidth:6,
          labelColor:cfg.yearVwap||'#e8d44d'
        });
        curves.push({
          id:'y-upper-'+seg.year,
          label:'',
          points:seg.points.map(p=>({time:p.time,value:p.upper})),
          color:cfg.yearSigma||'rgba(190,196,208,.55)',
          width:1,
          underlay:cfg.underlay||'rgba(190,196,208,.10)',
          underlayWidth:6
        });
        curves.push({
          id:'y-lower-'+seg.year,
          label:'',
          points:seg.points.map(p=>({time:p.time,value:p.lower})),
          color:cfg.yearSigma||'rgba(190,196,208,.55)',
          width:1,
          underlay:cfg.underlay||'rgba(190,196,208,.10)',
          underlayWidth:6
        });
      }
      return{curves,rolling,yearSegments};
    },

    infoLine(ctx,bar,add){
      const {state,model,line2,fmtPrice}=ctx;
      line2.appendChild(document.createTextNode('Rolling VWAP (hlc3, 4h)'));
      const valueAt=points=>{
        const point=(points||[]).find(x=>Number(x.time)===Number(bar.time));
        return point&&Number.isFinite(Number(point.value))?Number(point.value):null;
      };
      const values={};
      for(const days of (state.rules.rvwap&&state.rules.rvwap.windowsDays)||[30,60,90,365]){
        const value=valueAt(model.rvwap&&model.rvwap.rolling&&model.rvwap.rolling[String(days)]);
        values[String(days)]=value;
        add('  '+days+'D '+(value==null?'—':fmtPrice(value)),'vwap');
      }
      const seg=(model.rvwap&&model.rvwap.yearSegments||[]).find(x=>Number(bar.time)>=x.start&&Number(bar.time)<x.end);
      const point=seg&&(seg.points||[]).find(x=>Number(x.time)===Number(bar.time));
      const yv=point&&point.vwap;
      const yu=point&&point.upper;
      const yl=point&&point.lower;
      add('  ·  Y VWAP '+(yv==null?'—':fmtPrice(yv)),'yvwap');
      add('  +1σ '+(yu==null?'—':fmtPrice(yu)),'sigma');
      add('  −1σ '+(yl==null?'—':fmtPrice(yl)),'sigma');
      model.infoValues={rolling:values,year:{vwap:yv,upper:yu,lower:yl},barTime:Number(bar.time)};
    },

    manifestValues(){
      return null;
    }
  };
})(typeof globalThis!=='undefined'?globalThis:window);
