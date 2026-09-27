(function(global){
  'use strict';

  function stablePrice(p){return Number(p).toFixed(8).replace(/0+$/,'').replace(/\.$/,'');}
  function stableId(rule,scope,price){return [rule,scope,stablePrice(price)].join(':').replace(/[^A-Za-z0-9:._-]/g,'_');}
  const rank={PY:6,PQ:5,PM:4,PW:3,Q4:4,Q3:4,Q2:4,Q1:4,PY_Q:5,PY_M:3,W:2,M:3};

  function scopeRank(scope){return rank[scope]||1;}

  function filterLevels(levels,ctx,cfg){
    const current=Number(ctx.currentPrice),min=Number(ctx.visibleMin),max=Number(ctx.visibleMax);
    const pad=(max-min)*(Number(cfg.visiblePadPct)||0)/100;
    const kept=(levels||[]).filter(l=>Number(l.price)>=min-pad&&Number(l.price)<=max+pad);
    kept.sort((a,b)=>{
      const da=Math.abs(Number(a.price)-current),db=Math.abs(Number(b.price)-current);
      if(da!==db)return da-db;
      const sr=scopeRank(b.scope)-scopeRank(a.scope);
      if(sr!==0)return sr;
      return String(a.label).localeCompare(String(b.label));
    });
    return kept.slice(0,Number(cfg.maxLabels)||kept.length);
  }

  function mergeLevels(levels,tolerancePct){
    const sorted=(levels||[]).slice().sort((a,b)=>Number(a.price)-Number(b.price)||scopeRank(b.scope)-scopeRank(a.scope)||String(a.label).localeCompare(String(b.label)));
    const out=[];
    for(const level of sorted){
      const last=out[out.length-1];
      const tol=Math.abs(Number(level.price))*(Number(tolerancePct)||0)/100;
      if(last && Math.abs(Number(level.price)-Number(last.price))<=tol){
        const primary=scopeRank(level.scope)>scopeRank(last.scope)?level:last;
        const other=primary===level?last:level;
        primary.label=[primary.label,other.label].filter(Boolean).join(' · ');
        primary.id=stableId('merged',primary.scope,primary.price);
        primary.source=primary.source==='exact'&&other.source==='exact'?'exact':'approx';
        out[out.length-1]=primary;
      }else out.push({...level});
    }
    return out;
  }

  function findTouch(level,bars,lookback,tolerance){
    const slice=(bars||[]).slice(-Math.max(1,lookback||60));
    for(let i=slice.length-1;i>=0;i-=1){
      const b=slice[i];
      if(Number(b.low)-(tolerance||0)<=level.price && level.price<=Number(b.high)+(tolerance||0))return b;
    }
    return null;
  }

  function findCross(level,bars,confirmBars){
    const n=Math.max(1,confirmBars||2),p=Number(level.price),a=bars||[];
    for(let i=a.length-n-1;i>=1;i-=1){
      const prev=Number(a[i-1].close),cur=Number(a[i].close);
      if(prev<=p&&cur>p){
        let ok=true;for(let j=1;j<=n;j+=1)if(Number(a[i+j].close)<=p)ok=false;
        if(ok)return {bar:a[i],direction:'above',shape:'arrowUp'};
      }
      if(prev>=p&&cur<p){
        let ok=true;for(let j=1;j<=n;j+=1)if(Number(a[i+j].close)>=p)ok=false;
        if(ok)return {bar:a[i],direction:'below',shape:'arrowDown'};
      }
    }
    return null;
  }

  function cutoffNakedPoc(level,bars,tolerance){
    for(const b of bars||[]){
      if(Number(b.time)<=Number(level.from))continue;
      if(Number(b.low)-(tolerance||0)<=level.price && level.price<=Number(b.high)+(tolerance||0))return Number(b.time);
    }
    return null;
  }

  function levelItem(level){
    return {
      id:level.id||stableId('level',level.scope||'X',level.price),type:'level',price:Number(level.price),
      label:level.label+(level.source==='approx'&&!String(level.label).endsWith('≈')?' ≈':''),
      from:Number(level.from),to:level.to==null?null:Number(level.to),style:level.style||'dashed',
      color:level.color||'#e6e6e6',axisLabel:true,group:level.group||'auto',source:level.source||'approx'
    };
  }

  function buildLevelAnnotations(levels,bars,ctx,config){
    const cfg=config.levels||{},tick=Number(ctx.tickSize)||0;
    const merged=mergeLevels(levels,cfg.mergeTolerancePct);
    const filtered=filterLevels(merged,ctx,cfg);
    const items=[];
    for(const l of filtered){
      items.push(levelItem(l));
      const touch=findTouch(l,bars,config.touch&&config.touch.lookbackBars,(config.touch&&config.touch.toleranceTicks||0)*tick);
      if(touch)items.push({id:stableId('touch',l.scope||'X',l.price),type:'marker',shape:'circle',time:touch.time,price:Number(l.price),text:'touch '+l.label,pane:0,source:l.source||'approx'});
      if(config.cross&&config.cross.enabled){
        const cross=findCross(l,bars,config.cross.confirmBars);
        if(cross)items.push({id:stableId('cross-'+cross.direction,l.scope||'X',l.price),type:'marker',shape:cross.shape,time:cross.bar.time,price:Number(l.price),text:'close '+cross.direction+' '+l.label,pane:0,source:l.source||'approx'});
      }
    }
    return items;
  }

  function profileLevels(profile,scope,from,source){
    if(!profile)return[];
    return [
      {scope,label:scope+' VAH',price:profile.vah,from,source},
      {scope,label:scope+' POC',price:profile.poc,from,source},
      {scope,label:scope+' VAL',price:profile.val,from,source}
    ].filter(x=>Number.isFinite(x.price));
  }

  function buildPreset(input){
    const preset=input.preset,bars=input.bars||[],now=bars.length?bars[bars.length-1].time:0;
    const items=[];
    if(preset==='p1'){
      const v=input.vwap||[];
      if(v.length)items.push({id:'auto:p1:vwap',type:'band',label:'Q VWAP',points:v.map(p=>[p.time,p.vwap,p.upper,p.lower]),color:'#5cb85c',source:'approx'});
      const levels=profileLevels(input.previousQuarterVp,'PQ',input.previousQuarterFrom,'approx');
      items.push(...buildLevelAnnotations(levels,bars,input.context,input.config));
      if(v.length){
        const first=v[0];items.push({id:'auto:p1:q-vwap-start',type:'level',price:first.vwap,label:'Q VWAP start',from:first.time,to:null,style:'solid',color:'#2e7d32',axisLabel:true,source:'approx'});
      }
    }else if(preset==='p2'||preset==='p3'){
      const profiles=input.tpoProfiles||[];
      const latest=profiles.slice(-3);
      for(const p of latest){
        items.push({id:'auto:'+preset+':tpo:'+p.key,type:'profile',kind:'tpo',from:p.from,to:p.to,binSize:p.binSize,rows:p.rows,poc:p.poc,vah:p.vah,val:p.val,maxWidthBars:40,showLetters:false,source:'approx'});
        for(const s of p.singlePrints||[])items.push({id:stableId('single',p.key,s.bottom),type:'zone',top:s.top,bottom:s.bottom,from:p.from,to:p.to,label:'single prints',border:'#f4f6fb',fill:'rgba(244,246,251,.06)',source:'approx'});
      }
      if(preset==='p3'&&input.exactWeekly){
        const levels=profileLevels(input.exactWeekly,'PW',input.exactWeeklyFrom,'exact');
        items.push(...buildLevelAnnotations(levels,bars,input.context,input.config));
      }
    }else if(preset==='p4'){
      const p=input.previousMonthVp;
      if(p)items.push({id:'auto:p4:month-zone',type:'zone',top:p.vah,bottom:p.val,from:input.previousMonthFrom,to:null,label:'PM value area ≈',border:'#4fc3f7',fill:'rgba(79,195,247,0.10)',group:'month',source:'approx'});
    }
    items.sort((a,b)=>String(a.id).localeCompare(String(b.id)));
    return {schema:'annotations-v1',symbol:input.symbol,market:input.market,interval:input.interval,generatedAt:new Date(Number(now)*1000).toISOString(),items};
  }

  global.OrderFlowAnnotate={
    stableId,filterLevels,mergeLevels,findTouch,findCross,cutoffNakedPoc,buildLevelAnnotations,profileLevels,buildPreset
  };
})(typeof globalThis!=='undefined'?globalThis:window);
