(function(global){
  'use strict';

  const registry=global.OrderFlowTemplates=global.OrderFlowTemplates||{};

  registry.wprofile={
    modelKey:'wprofile',

    build(ctx){
      const {
        state,
        E,
        bundle,
        display,
        symbolMeta,
        extrema,
        normalizeTpoPeriod,
        weekLabel,
        colorAlpha
      }=ctx;
      if(state.timeframe!=='1d'||!display.length){
        return{profiles:[],levels:[],regions:[],current:null,naked:[],extensions:[],priceWindow:null};
      }

      const cfg=state.rules.wprofile||{};
      const colors=cfg.colors||{};
      const pre=((bundle.tpo&&bundle.tpo.weekly)||[])
        .filter(item=>item.complete===true)
        .map(normalizeTpoPeriod)
        .sort((a,b)=>a.startSec-b.startSec);
      const last=display[display.length-1];
      const currentPrice=Number(last.close);
      const weekStart=E.utcWeekStart(last.time);
      const weekEnd=weekStart+7*86400;
      const rowSize=(Number(symbolMeta().tickSize)||.01)*Number(cfg.rowTicks||100);
      const weekBars=(bundle.series['30m']||[]).filter(
        bar=>Number(bar.time)>=weekStart&&Number(bar.time)<weekEnd
      );
      const currentProfile=weekBars.length?E.tpoProfile(weekBars,rowSize):null;
      const extremes=weekBars.length?extrema(weekBars):null;
      const current=currentProfile&&Number.isFinite(Number(currentProfile.poc))?{
        startSec:weekStart,
        endSec:weekEnd,
        complete:false,
        forming:true,
        bars:weekBars.length,
        rowSize,
        poc:Number(currentProfile.poc),
        vah:Number(currentProfile.vah),
        val:Number(currentProfile.val),
        high:extremes.max,
        low:extremes.min,
        rows:currentProfile.rows
      }:null;

      const priceWindow=E.profilePriceWindow(currentPrice,cfg.priceWindowPct,current);
      const inPrice=price=>priceWindow&&Number(price)>=priceWindow.min&&Number(price)<=priceWindow.max;
      const intersects=(bottom,top)=>{
        return priceWindow&&Number(top)>=priceWindow.min&&Number(bottom)<=priceWindow.max;
      };

      const ended=pre.slice(-25);
      const profileColors={
        value:colors.value||'rgba(255,152,0,.9)',
        outside:colors.outside||'rgba(150,150,150,.6)',
        poc:colors.poc||'#ffeb3b'
      };
      const profiles=ended
        .filter(item=>Array.isArray(item.rows))
        .map(item=>({
          ...item,
          start:item.startSec,
          end:item.endSec,
          colors:profileColors,
          forming:false
        }));
      if(current){
        profiles.push({...current,start:current.startSec,end:current.endSec,colors:profileColors});
      }

      const extensions=E.profileExtensions(pre,['vah','val','poc']);
      const visibleStarts=new Set(ended.map(item=>item.startSec));
      const touched=E.selectRecentTouched(
        extensions.filter(item=>!item.naked&&visibleStarts.has(item.from)),
        cfg.maxTouched||8
      );
      const distance=item=>Math.abs(Number(item.price)-currentPrice);
      const nakedAll=extensions.filter(item=>item.naked);
      const naked=nakedAll
        .filter(item=>inPrice(item.price))
        .sort((a,b)=>{
          const distanceA=distance(a);
          const distanceB=distance(b);
          const priorityA=a.side==='poc'?0:1;
          const priorityB=b.side==='poc'?0:1;
          return distanceA-distanceB||priorityA-priorityB;
        })
        .slice(0,Number(cfg.maxNaked)||16)
        .map(item=>({...item,touchedThisPeriod:E.profileTouchedThisPeriod(item,current)}));
      const nakedKeys=new Set(naked.map(item=>item.from+'|'+item.side));
      const drawnNaked=nakedAll.filter(item=>{
        return !inPrice(item.price)||nakedKeys.has(item.from+'|'+item.side);
      });
      const chosen=touched.concat(drawnNaked);
      const levels=[];

      for(const item of chosen){
        const isPoc=item.side==='poc';
        const base=isPoc?(colors.pocLine||'#e6d600'):(colors.valueLine||'#ff9800');
        const faded=isPoc?'rgba(230,214,0,.45)':'rgba(255,152,0,.45)';
        const touchedThisPeriod=E.profileTouchedThisPeriod(item,current);
        levels.push({
          id:'wprofile-'+item.from+'-'+item.side,
          kind:'wprofile',
          price:item.price,
          from:item.from,
          to:item.to,
          label:'',
          color:item.naked?base:faded,
          axisColor:touchedThisPeriod?colorAlpha(base,.5):base,
          axisTextColor:'#0b1220',
          axisLabel:item.naked,
          style:touchedThisPeriod?'dashed':'solid',
          width:1,
          naked:item.naked,
          touchedThisPeriod,
          week:new Date(item.from*1000).toISOString().slice(0,10),
          side:item.side
        });
      }

      if(current&&inPrice(current.poc)){
        levels.push({
          id:'wprofile-current-poc',
          kind:'wprofile',
          price:current.poc,
          from:weekStart,
          label:'',
          color:colors.pocLine||'#e6d600',
          axisColor:colors.pocLine||'#e6d600',
          axisTextColor:'#0b1220',
          axisLabel:true,
          style:'dashed',
          width:1,
          current:true,
          side:'poc'
        });
      }

      const manual=cfg.referenceWeek&&cfg.referenceWeek[state.symbol];
      const reference=E.selectReferenceWeek(pre,currentPrice,manual);
      const regions=[];
      if(reference){
        const referenceStart=Date.parse(String(reference.start))/1000;
        const label=weekLabel(referenceStart)+' range';
        regions.push({
          id:'wprofile-ref-'+referenceStart,
          type:'value',
          scope:'WPROFILE_REF',
          bottom:Number(reference.low),
          top:Number(reference.high),
          from:referenceStart,
          label,
          fill:colors.referenceFill||'rgba(190,196,208,.08)',
          border:colors.referenceBorder||'#40a0be',
          axisColor:colors.referenceBorder||'#40a0be',
          axisTextColor:'#0b1220',
          axisLabel:true,
          labelColor:'#ffffff',
          labelSize:11,
          labelWeight:600
        });
      }

      const allSinglePrints=E.remainingSinglePrints(
        pre,
        currentPrice,
        rowSize,
        Number.MAX_SAFE_INTEGER
      );
      const maxSingle=Math.max(0,Number(cfg.maxSinglePrints)||6);
      const visibleSinglePrints=allSinglePrints
        .filter(item=>intersects(item.bottom,item.top))
        .slice(0,maxSingle);
      const visibleKeys=new Set(
        visibleSinglePrints.map(item=>item.from+'|'+item.bottom+'|'+item.top)
      );
      const singlePrints=allSinglePrints.filter(item=>{
        return !intersects(item.bottom,item.top)||
          visibleKeys.has(item.from+'|'+item.bottom+'|'+item.top);
      });
      for(const item of singlePrints){
        regions.push({
          id:'wprofile-sp-'+item.from+'-'+item.bottom,
          type:'value',
          scope:'SINGLE_PRINT',
          bottom:item.bottom,
          top:item.top,
          from:item.from,
          label:'',
          fill:'rgba(168,162,58,.10)',
          border:'#a8a23a',
          axisColor:'#a8a23a',
          axisTextColor:'#0b1220',
          axisLabel:true
        });
      }

      return{
        profiles,
        levels,
        regions,
        current,
        naked,
        extensions,
        ended,
        pre,
        reference,
        singlePrints:visibleSinglePrints,
        allSinglePrints:singlePrints,
        priceWindow
      };
    },

    infoLine(ctx,bar,add){
      const {model,line2,fmtPrice,weekLabel}=ctx;
      const profile=model.wprofile||{};
      const current=profile.current;
      line2.appendChild(document.createTextNode('Weekly TPO (30m, 70%)'));
      add(
        '  '+(
          current
            ?'POC '+fmtPrice(current.poc)+'  VAH '+fmtPrice(current.vah)+'  VAL '+fmtPrice(current.val)
            :'POC —  VAH —  VAL —'
        ),
        'tpo'
      );
      const reference=profile.reference;
      const referenceStart=reference&&Date.parse(String(reference.start))/1000;
      const referenceText=reference
        ?weekLabel(referenceStart)+' '+fmtPrice(reference.high)+' / '+fmtPrice(reference.low)
        :'—';
      add('  ·  Ref '+referenceText,'muted');
      const touchedNow=(profile.naked||[]).filter(item=>item.touchedThisPeriod).length;
      add('  ·  naked '+String((profile.naked||[]).length)+' ('+touchedNow+' this period)','tpo');
      add('  ·  SP '+String((profile.singlePrints||[]).length),'tpo');
      model.infoValues={
        currentPoc:current&&current.poc,
        reference:reference?{
          week:new Date(referenceStart*1000).toISOString().slice(0,10),
          high:Number(reference.high),
          low:Number(reference.low),
          manual:!!reference.manual
        }:null,
        naked:(profile.naked||[]).map(item=>({
          week:new Date(item.from*1000).toISOString().slice(0,10),
          side:item.side,
          price:item.price,
          touchedThisPeriod:!!item.touchedThisPeriod
        })),
        singlePrints:(profile.singlePrints||[]).map(item=>({
          week:new Date(item.from*1000).toISOString().slice(0,10),
          bottom:item.bottom,
          top:item.top
        })),
        barTime:Number(bar.time)
      };
    },

    manifestValues(ctx){
      const profile=ctx.model.wprofile||{};
      const reference=profile.reference;
      const referenceStart=reference&&Date.parse(String(reference.start))/1000;
      return{
        currentPoc:profile.current&&profile.current.poc,
        reference:reference?{
          week:new Date(referenceStart*1000).toISOString().slice(0,10),
          high:Number(reference.high),
          low:Number(reference.low),
          manual:!!reference.manual
        }:null,
        naked:(profile.naked||[]).map(item=>({
          week:new Date(item.from*1000).toISOString().slice(0,10),
          side:item.side,
          price:item.price,
          touchedThisPeriod:!!item.touchedThisPeriod
        })),
        singlePrints:(profile.singlePrints||[]).map(item=>({
          week:new Date(item.from*1000).toISOString().slice(0,10),
          bottom:item.bottom,
          top:item.top
        }))
      };
    }
  };
})(typeof globalThis!=='undefined'?globalThis:window);
