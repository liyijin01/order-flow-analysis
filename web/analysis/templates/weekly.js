(function(global){
  'use strict';

  const registry=global.OrderFlowTemplates=global.OrderFlowTemplates||{};

  registry.weekly={
    needs(){return{'30m':2000,'1d':400};},

    build(ctx){
      const {state,E,I,bundle,display,view}=ctx;
      if(state.timeframe!=='30m'||!display.length){
        return{curves:[],regions:[],levels:[],segments:[],projections:[],yearOpen:null};
      }
      const cfg=state.rules.weeklyVwap||{};
      const thirty=bundle.series['30m']||[];
      const daily=bundle.series['1d']||[];
      const stats=I.weeklyVwapStats(thirty,1800);
      const projectionMap=new Map(I.weeklyProjectionStats(stats).map(x=>[Number(x.weekStart),x]));
      const first=Number(display[0].time);
      const last=Number(display[display.length-1].time);
      const currentStart=E.utcWeekStart(last);
      const byStart=new Map(stats.map(x=>[Number(x.start),x]));
      const span=Math.max(1e-12,Number(view.max)-Number(view.min));
      const pad=span*Math.max(0,Number(cfg.visiblePadPct)||10)/100;
      const lo=Number(view.min)-pad;
      const hi=Number(view.max)+pad;
      const inView=value=>Number(value)>=lo&&Number(value)<=hi;
      const curves=[];
      const regions=[];
      const levels=[];
      const segments=[];
      const projections=[];

      for(const seg of stats){
        if(Number(seg.end)<=first||Number(seg.start)>last)continue;
        segments.push(seg);
        const points=(seg.points||[]).filter(p=>Number(p.time)>=first&&Number(p.time)<=last);
        const makeCurve=(id,key,color,width)=>({
          id:id+'-'+seg.start,
          label:'',
          weekStart:seg.start,
          points:points.map(p=>({time:p.time,value:inView(p[key])?p[key]:null})),
          color,
          width,
          underlay:cfg.underlay||'rgba(190,196,208,.10)',
          underlayWidth:6
        });
        curves.push(
          makeCurve('weekly-vwap','vwap',cfg.vwap||'#f23645',1.5),
          makeCurve('weekly-upper','upper',cfg.sigma||'rgba(190,196,208,.55)',1),
          makeCurve('weekly-lower','lower',cfg.sigma||'rgba(190,196,208,.55)',1)
        );
        const baseProjection=projectionMap.get(Number(seg.start));
        if(!baseProjection)continue;
        const top=Number(baseProjection.pwUpper);
        const bottom=Number(baseProjection.pwLower);
        const mid=Number(baseProjection.pwVwap);
        const to=Math.min(Number(seg.end),last);
        const visible=top>=lo&&bottom<=hi;
        const isCurrent=Number(seg.start)===currentStart;
        projections.push({...baseProjection,to,complete:true});
        if(!visible)continue;
        regions.push({
          id:'weekly-proj-'+seg.start,
          type:'value',
          scope:'WEEKLY_PROJECTION',
          bottom,
          top,
          from:Number(seg.start),
          to,
          label:'',
          fill:cfg.projectionFill||'rgba(190,196,208,.08)',
          border:cfg.projectionBorder||'rgba(190,196,208,.25)',
          axisLabel:isCurrent,
          axisColor:cfg.axisGray||'#3a4152',
          axisTextColor:cfg.axisText||'#eceff4'
        });
        levels.push({
          id:'weekly-pw-vwap-'+seg.start,
          kind:'weekly-pw',
          price:mid,
          from:Number(seg.start),
          to,
          label:'',
          color:cfg.vwap||'#f23645',
          axisColor:cfg.vwap||'#f23645',
          axisTextColor:'#fff',
          axisLabel:isCurrent,
          style:'solid',
          width:1.5,
          pairedRegionId:'weekly-proj-'+seg.start
        });
      }

      const current=byStart.get(currentStart);
      if(current&&current.points.length){
        const point=current.points[current.points.length-1];
        for(const [key,color] of [
          ['vwap',cfg.vwap||'#f23645'],
          ['upper',cfg.axisGray||'#3a4152'],
          ['lower',cfg.axisGray||'#3a4152']
        ]){
          const price=Number(point[key]);
          if(inView(price)){
            levels.push({
              id:'weekly-current-'+key,
              kind:'weekly',
              price,
              from:last,
              label:'',
              draw:false,
              color,
              axisColor:color,
              axisTextColor:'#fff',
              axisLabel:true
            });
          }
        }
      }

      const year=new Date(last*1000).getUTCFullYear();
      const yearStart=Date.UTC(year,0,1)/1000;
      const day=daily.find(bar=>Number(bar.time)===yearStart);
      const yearOpen=day?Number(day.open):null;
      if(Number.isFinite(yearOpen)&&inView(yearOpen)){
        levels.push({
          id:'year-open-'+year,
          kind:'year-open',
          price:yearOpen,
          from:first,
          label:'Y O',
          color:cfg.yearOpen||'#e6e9ef',
          axisColor:cfg.yearAxis||'#d9d4f0',
          axisTextColor:cfg.yearAxisText||'#202536',
          axisLabel:true,
          style:'solid',
          width:1
        });
      }
      return{curves,regions,levels,segments,projections,yearOpen,currentStart};
    },

    infoLine(ctx,bar,add){
      const {model,line2,fmtPrice}=ctx;
      line2.appendChild(document.createTextNode('Weekly VWAP (hlc3, 30m, ±1σ)'));
      const seg=(model.weekly&&model.weekly.segments||[]).find(
        item=>Number(bar.time)>=Number(item.start)&&Number(bar.time)<Number(item.end)
      );
      const point=seg&&(seg.points||[]).find(item=>Number(item.time)===Number(bar.time));
      const projection=seg&&(model.weekly&&model.weekly.projections||[]).find(
        item=>Number(item.weekStart)===Number(seg.start)
      );
      const vwap=point&&point.vwap;
      const upper=point&&point.upper;
      const lower=point&&point.lower;
      add('  '+(vwap==null?'—':fmtPrice(vwap)),'weeklyvwap');
      add('  +1σ '+(upper==null?'—':fmtPrice(upper)),'sigma');
      add('  −1σ '+(lower==null?'—':fmtPrice(lower)),'sigma');
      add('  ·  PW '+(!projection?'—':fmtPrice(projection.pwVwap)),'weeklyvwap');
      add('  +1σ '+(!projection?'—':fmtPrice(projection.pwUpper)),'sigma');
      add('  −1σ '+(!projection?'—':fmtPrice(projection.pwLower)),'sigma');
      const yearOpen=model.weekly&&model.weekly.yearOpen;
      add('  ·  Y O '+(Number.isFinite(Number(yearOpen))?fmtPrice(yearOpen):'—'),'muted');
      model.infoValues={
        weekly:{vwap,upper,lower},
        previous:projection||null,
        yearOpen,
        barTime:Number(bar.time)
      };
    },

    manifestValues(ctx){
      const model=ctx.model;
      const last=Number(model.last.time);
      const seg=(model.weekly&&model.weekly.segments||[]).find(
        item=>last>=Number(item.start)&&last<Number(item.end)
      );
      const point=seg&&(seg.points||[]).find(item=>Number(item.time)===last);
      const projection=seg&&(model.weekly&&model.weekly.projections||[]).find(
        item=>Number(item.weekStart)===Number(seg.start)
      );
      return{
        weekStart:seg&&seg.start,
        vwap:point&&point.vwap,
        upper:point&&point.upper,
        lower:point&&point.lower,
        pwVwap:projection&&projection.pwVwap,
        pwUpper:projection&&projection.pwUpper,
        pwLower:projection&&projection.pwLower,
        yearOpen:model.weekly&&model.weekly.yearOpen
      };
    }
  };
})(typeof globalThis!=='undefined'?globalThis:window);
