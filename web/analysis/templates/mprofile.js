(function(global){
  'use strict';

  const registry=global.OrderFlowTemplates=global.OrderFlowTemplates||{};
  const MONTH_SHORT=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  registry.mprofile={
    modelKey:'mprofile',

    needs(){return{'1d':430,'30m':1500};},

    build(ctx){
      const {
        state,
        E,
        bundle,
        display,
        symbolMeta,
        extrema,
        nextMonthStartSec,
        normalizeTpoPeriod,
        monthLabelFromStart,
        colorAlpha
      }=ctx;
      if(state.timeframe!=='1d'||!display.length){
        return{profiles:[],levels:[],regions:[],current:null,box:null,naked:[],priceWindow:null};
      }

      const cfg=state.rules.mprofile||{};
      const colors=cfg.colors||{};
      const pre=((bundle.tpo&&bundle.tpo.monthly)||[])
        .filter(item=>item.complete===true)
        .map(normalizeTpoPeriod)
        .sort((a,b)=>a.startSec-b.startSec);
      const last=display[display.length-1];
      const currentPrice=Number(last.close);
      const monthStart=E.utcMonthStart(last.time);
      const monthEnd=nextMonthStartSec(monthStart);
      const rowSize=(Number(symbolMeta().tickSize)||.01)*Number(cfg.rowTicks||100);
      const monthBars=(bundle.series['30m']||[]).filter(
        bar=>Number(bar.time)>=monthStart&&Number(bar.time)<monthEnd
      );
      const currentProfile=monthBars.length?E.tpoProfile(monthBars,rowSize):null;
      const extremes=monthBars.length?extrema(monthBars):null;
      const current=currentProfile&&Number.isFinite(Number(currentProfile.poc))?{
        startSec:monthStart,
        endSec:monthEnd,
        complete:false,
        forming:true,
        bars:monthBars.length,
        expectedBars:null,
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

      const ended=pre.slice(-11);
      const profileColors={
        value:colors.value||'rgba(64,160,190,.85)',
        outside:colors.outside||'rgba(150,150,150,.6)',
        poc:colors.poc||'#ffeb3b'
      };
      const profiles=ended.map(item=>({
        ...item,
        start:item.startSec,
        end:item.endSec,
        colors:profileColors,
        forming:false
      }));
      if(current){
        profiles.push({...current,start:current.startSec,end:current.endSec,colors:profileColors});
      }

      const visibleStarts=new Set(ended.map(item=>item.startSec));
      const extensions=E.profileExtensions(pre,['vah','val','poc']).filter(
        item=>visibleStarts.has(item.from)
      );
      const touched=E.selectRecentTouched(
        extensions.filter(item=>!item.naked),
        cfg.maxTouched||8
      );
      const nakedExtensions=extensions.filter(item=>item.naked);
      const chosen=touched.concat(nakedExtensions);
      const levels=[];

      for(const item of chosen){
        const date=new Date(item.from*1000);
        const month=MONTH_SHORT[date.getUTCMonth()];
        const isPoc=item.side==='poc';
        const base=isPoc?(colors.pocLine||'#e6d600'):(colors.valueLine||'#40a0be');
        const faded=isPoc?'rgba(230,214,0,.45)':'rgba(64,160,190,.45)';
        const touchedThisPeriod=E.profileTouchedThisPeriod(item,current);
        levels.push({
          id:'mprofile-'+item.from+'-'+item.side,
          kind:'mprofile',
          price:item.price,
          from:item.from,
          to:item.to,
          label:item.naked?month+' '+item.side.toUpperCase():'',
          color:item.naked?base:faded,
          axisColor:touchedThisPeriod?colorAlpha(base,.5):base,
          axisTextColor:'#0b1220',
          axisLabel:item.naked,
          style:touchedThisPeriod?'dashed':'solid',
          width:1,
          labelSize:11,
          labelWeight:600,
          naked:item.naked,
          touchedThisPeriod,
          month,
          side:item.side
        });
      }

      if(current&&inPrice(current.poc)){
        const date=new Date(monthStart*1000);
        const month=MONTH_SHORT[date.getUTCMonth()];
        levels.push({
          id:'mprofile-current-poc',
          kind:'mprofile',
          price:current.poc,
          from:monthStart,
          label:month+' POC',
          color:colors.pocLine||'#e6d600',
          axisColor:colors.pocLine||'#e6d600',
          axisTextColor:'#0b1220',
          axisLabel:true,
          style:'dashed',
          width:1,
          labelSize:11,
          labelWeight:600,
          current:true,
          side:'poc'
        });
      }

      const box=E.selectProfileValueBox(ended,currentPrice);
      const regions=[];
      if(box){
        const year=new Date(monthStart*1000).getUTCFullYear();
        const label=monthLabelFromStart(box.startSec,year)+' VA';
        regions.push({
          id:'mprofile-box-'+box.startSec,
          type:'value',
          scope:'MPROFILE_BOX',
          bottom:box.val,
          top:box.vah,
          from:box.startSec,
          label,
          fill:colors.boxFill||'rgba(255,255,255,.03)',
          border:colors.boxBorder||'#ffffff',
          axisLabel:false,
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
          id:'mprofile-sp-'+item.from+'-'+item.bottom,
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
        box,
        naked:levels.filter(item=>item.naked&&inPrice(item.price)),
        extensions,
        singlePrints:visibleSinglePrints,
        allSinglePrints:singlePrints,
        priceWindow
      };
    },

    infoLine(ctx,bar,add){
      const {model,line2,fmtPrice,monthLabelFromStart}=ctx;
      const profile=model.mprofile||{};
      const current=profile.current;
      const box=profile.box;
      line2.appendChild(document.createTextNode('Monthly TPO (30m, 70%)'));
      add(
        '  '+(
          current
            ?'POC '+fmtPrice(current.poc)+'  VAH '+fmtPrice(current.vah)+'  VAL '+fmtPrice(current.val)
            :'POC —  VAH —  VAL —'
        ),
        'tpo'
      );
      const currentYear=new Date(model.last.time*1000).getUTCFullYear();
      const boxText=box
        ?monthLabelFromStart(box.startSec,currentYear)+' VA '+fmtPrice(box.vah)+' / '+fmtPrice(box.val)
        :'—';
      add('  ·  Box '+boxText,'muted');
      const touchedNow=(profile.naked||[]).filter(item=>item.touchedThisPeriod).length;
      add('  ·  naked '+String((profile.naked||[]).length)+' ('+touchedNow+' this period)','tpo');
      add('  ·  SP '+String((profile.singlePrints||[]).length),'tpo');
      model.infoValues={
        currentPoc:current&&current.poc,
        box:box?{
          month:new Date(box.startSec*1000).toISOString().slice(0,7),
          vah:box.vah,
          val:box.val
        }:null,
        naked:(profile.naked||[]).map(item=>({
          month:new Date(item.from*1000).toISOString().slice(0,7),
          side:item.side,
          price:item.price,
          touchedThisPeriod:!!item.touchedThisPeriod
        })),
        singlePrints:(profile.singlePrints||[]).map(item=>({
          month:new Date(item.from*1000).toISOString().slice(0,7),
          bottom:item.bottom,
          top:item.top
        })),
        barTime:Number(bar.time)
      };
    },

    manifestValues(ctx){
      const profile=ctx.model.mprofile||{};
      const box=profile.box;
      return{
        currentPoc:profile.current&&profile.current.poc,
        box:box?{
          month:new Date(box.startSec*1000).toISOString().slice(0,7),
          vah:box.vah,
          val:box.val
        }:null,
        naked:(profile.naked||[]).map(item=>({
          month:new Date(item.from*1000).toISOString().slice(0,7),
          side:item.side,
          price:item.price,
          touchedThisPeriod:!!item.touchedThisPeriod
        })),
        singlePrints:(profile.singlePrints||[]).map(item=>({
          month:new Date(item.from*1000).toISOString().slice(0,7),
          bottom:item.bottom,
          top:item.top
        }))
      };
    }
  };
})(typeof globalThis!=='undefined'?globalThis:window);
