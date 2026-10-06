(function(global){
  'use strict';

  const registry=global.OrderFlowTemplates=global.OrderFlowTemplates||{};

  registry.monthly={
    build(ctx){
      const {state,I,bundle,display,view}=ctx;
      if(state.timeframe!=='1M'||!display.length){
        return{levels:[],regions:[],upper:null,lower:null,imbalance:null};
      }
      const cfg=state.rules.monthlyStructure||{};
      const monthly=bundle.series['1M']||display;
      const last=display[display.length-1];
      const current=Number(last.close);
      const asOfMs=state.snapshot&&bundle.cutoffUtc?Date.parse(bundle.cutoffUtc)+1000:Date.now();
      const structure=I.monthlyStructureLevels(monthly,current,asOfMs);
      const pad=Number(cfg.visiblePadPct)||10;
      const span=Math.max(1e-12,Number(view.max)-Number(view.min));
      const lo=Number(view.min)-span*pad/100;
      const hi=Number(view.max)+span*pad/100;
      const inView=price=>Number(price)>=lo&&Number(price)<=hi;
      const upper=structure.upper&&inView(structure.upper.price)?structure.upper:null;
      const lower=structure.lower&&inView(structure.lower.price)?structure.lower:null;
      const levels=[];

      for(const row of [upper,lower].filter(Boolean)){
        levels.push({
          id:'monthly-sr-'+row.side+'-'+row.month,
          kind:'monthly-sr',
          price:Number(row.price),
          from:Number(row.time),
          label:row.label,
          color:cfg.line||'#26c6da',
          axisColor:cfg.axis||'#26c6da',
          axisTextColor:cfg.axisText||'#0b1220',
          axisLabel:true,
          style:'solid',
          width:1,
          month:row.month,
          broken:!!row.broken,
          side:row.side
        });
      }

      const imbalance=I.selectMonthlyImbalance(
        I.monthlyImbalances(monthly,asOfMs),
        current,
        view.min,
        view.max,
        pad
      );
      const regions=[];
      if(imbalance){
        regions.push({
          id:'monthly-imbalance-'+imbalance.c1Month+'-'+imbalance.c3Month,
          type:'value',
          scope:'MONTHLY_IMBALANCE',
          bottom:Number(imbalance.low),
          top:Number(imbalance.high),
          from:Number(imbalance.c1),
          label:'imbalance',
          fill:cfg.fill||'rgba(38,198,218,.18)',
          border:cfg.line||'#26c6da',
          axisColor:cfg.axis||'#26c6da',
          axisTextColor:cfg.axisText||'#0b1220',
          axisLabel:true,
          labelColor:'#ffffff',
          labelSize:13,
          labelWeight:700,
          topStyle:imbalance.forming&&imbalance.formingEdge==='top'?'dashed':'solid',
          bottomStyle:imbalance.forming&&imbalance.formingEdge==='bottom'?'dashed':'solid',
          imbalanceType:imbalance.type,
          forming:!!imbalance.forming,
          c1Month:imbalance.c1Month,
          c3Month:imbalance.c3Month
        });
      }
      return{levels,regions,upper,lower,imbalance,asOfMs};
    },

    infoLine(ctx,bar,add){
      const {model,line2,fmtPrice}=ctx;
      const monthly=model.monthly||{};
      const upper=monthly.upper;
      const lower=monthly.lower;
      const gap=monthly.imbalance;
      line2.appendChild(document.createTextNode('Monthly structure'));
      add('  Above '+(upper?fmtPrice(upper.price)+' ('+upper.label+')':'—'),'monthly');
      add('  ·  Below '+(lower?fmtPrice(lower.price)+' ('+lower.label+')':'—'),'monthly');
      add('  ·  imbalance '+(gap?fmtPrice(gap.low)+' / '+fmtPrice(gap.high):'—'),'monthly');
      model.infoValues={upper:upper||null,lower:lower||null,imbalance:gap||null,barTime:Number(bar.time)};
    },

    manifestValues(ctx){
      const monthly=ctx.model.monthly||{};
      const line=row=>row?{price:row.price,label:row.label,month:row.month}:null;
      const gap=monthly.imbalance;
      return{
        upper:line(monthly.upper),
        lower:line(monthly.lower),
        imbalance:gap?{
          low:gap.low,
          high:gap.high,
          c1:gap.c1Month,
          c3:gap.c3Month,
          forming:!!gap.forming
        }:null
      };
    }
  };
})(typeof globalThis!=='undefined'?globalThis:window);
