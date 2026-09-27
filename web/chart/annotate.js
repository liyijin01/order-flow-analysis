(function(global){
  'use strict';

  const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const rank={PY:7,PY_Q:6,PQ:6,Q4:5,Q3:5,Q2:5,Q1:5,PY_M:4,PM:4,PW:3,W:2,M:2};

  function stablePrice(p){return Number(p).toFixed(8).replace(/0+$/,'').replace(/\.$/,'');}
  function stableId(rule,scope,price){return[rule,scope,stablePrice(price)].join(':').replace(/[^A-Za-z0-9:._-]/g,'_');}
  function scopeRank(scope){return rank[scope]||1;}
  function roundPrice(value,tickSize){
    const tick=Number(tickSize);
    if(!Number.isFinite(tick)||tick<=0)return Number(value);
    return Math.round(Number(value)/tick)*tick;
  }

  function filterLevels(levels,ctx,cfg){
    const current=Number(ctx.currentPrice),min=Number(ctx.visibleMin),max=Number(ctx.visibleMax);
    const pad=(max-min)*(Number(cfg.visiblePadPct)||0)/100;
    const kept=(levels||[]).filter(l=>Number(l.price)>=min-pad&&Number(l.price)<=max+pad).map(x=>({...x}));
    kept.sort((a,b)=>{
      const da=Math.abs(Number(a.price)-current),db=Math.abs(Number(b.price)-current);
      if(da!==db)return da-db;
      const sr=scopeRank(b.scope)-scopeRank(a.scope);
      if(sr!==0)return sr;
      return String(a.label).localeCompare(String(b.label));
    });
    const maxLabels=Math.max(0,Number(cfg.maxLabels)||kept.length);
    kept.forEach((level,index)=>{level.showLabel=index<maxLabels;});
    return kept;
  }

  function mergeLevels(levels,tolerancePct){
    const sorted=(levels||[]).map(x=>({...x})).sort((a,b)=>Number(a.price)-Number(b.price)||scopeRank(b.scope)-scopeRank(a.scope)||String(a.label).localeCompare(String(b.label)));
    const out=[];
    for(const level of sorted){
      const last=out[out.length-1];
      const tol=Math.abs(Number(level.price))*(Number(tolerancePct)||0)/100;
      if(last&&Math.abs(Number(level.price)-Number(last.price))<=tol){
        const primary=scopeRank(level.scope)>scopeRank(last.scope)?level:last;
        const other=primary===level?last:level;
        primary.label=[primary.label,other.label].filter(Boolean).join(' · ');
        primary.id=stableId('merged',primary.scope,primary.price);
        primary.source=primary.source==='exact'&&other.source==='exact'?'exact':'approx';
        primary.from=Math.max(Number(primary.from)||0,Number(other.from)||0);
        primary.to=primary.to==null||other.to==null?null:Math.max(Number(primary.to),Number(other.to));
        out[out.length-1]=primary;
      }else out.push(level);
    }
    return out;
  }

  function eligibleBars(bars,from,lookback){
    const after=(bars||[]).filter(b=>Number(b.time)>=Number(from||-Infinity));
    return after.slice(-Math.max(1,Number(lookback)||60));
  }

  function findTouch(level,bars,lookback,tolerance){
    const slice=eligibleBars(bars,level.from,lookback);
    for(let i=slice.length-1;i>=0;i-=1){
      const b=slice[i];
      if(Number(b.low)-(tolerance||0)<=Number(level.price)&&Number(level.price)<=Number(b.high)+(tolerance||0))return b;
    }
    return null;
  }

  function findCross(level,bars,confirmBars,lookback){
    const n=Math.max(1,Number(confirmBars)||2),p=Number(level.price),slice=eligibleBars(bars,level.from,lookback);
    for(let i=slice.length-n-1;i>=1;i-=1){
      const prev=Number(slice[i-1].close),cur=Number(slice[i].close);
      if(prev<=p&&cur>p){
        let ok=true;for(let j=1;j<=n;j+=1)if(Number(slice[i+j].close)<=p)ok=false;
        if(ok)return{bar:slice[i],direction:'above',shape:'arrowUp'};
      }
      if(prev>=p&&cur<p){
        let ok=true;for(let j=1;j<=n;j+=1)if(Number(slice[i+j].close)>=p)ok=false;
        if(ok)return{bar:slice[i],direction:'below',shape:'arrowDown'};
      }
    }
    return null;
  }

  function cutoffLevel(level,bars,tolerance){
    for(const b of bars||[]){
      if(Number(b.time)<Number(level.from))continue;
      if(Number(b.low)-(tolerance||0)<=Number(level.price)&&Number(level.price)<=Number(b.high)+(tolerance||0))return Number(b.time);
    }
    return null;
  }
  const cutoffNakedPoc=cutoffLevel;

  function levelItem(level,ctx){
    const price=roundPrice(level.price,ctx.tickSize);
    const showLabel=level.showLabel!==false;
    return{
      id:level.id||stableId('level',level.scope||'X',price),type:'level',price,
      label:String(level.label||'level'),
      from:Number(level.from),to:level.to==null?null:Number(level.to),style:level.style||'dashed',
      color:level.color||'#e6e6e6',axisLabel:showLabel,showLabel,group:level.group||'auto',source:level.source||'exact'
    };
  }

  function buildLevelAnnotations(levels,bars,ctx,config){
    const cfg={...(config.levels||{})};
    if(Number.isFinite(Number(ctx.maxLabels)))cfg.maxLabels=Number(ctx.maxLabels);
    const tick=Number(ctx.tickSize)||0;
    const rounded=(levels||[]).map(l=>({...l,price:roundPrice(l.price,tick)}));
    const merged=mergeLevels(rounded,cfg.mergeTolerancePct);
    const filtered=filterLevels(merged,ctx,cfg);
    const items=[];
    for(const l of filtered){
      items.push(levelItem(l,ctx));
      const touch=findTouch(l,bars,config.touch&&config.touch.lookbackBars,(config.touch&&config.touch.toleranceTicks||0)*tick);
      if(touch)items.push({
        id:stableId('touch',l.scope||'X',l.price),type:'marker',shape:'circle',time:touch.time,price:roundPrice(l.price,tick),
        text:'',hoverText:'touch '+l.label,pane:0,source:l.source||'exact'
      });
      if(config.cross&&config.cross.enabled){
        const cross=findCross(l,bars,config.cross.confirmBars,config.cross.lookbackBars||config.touch&&config.touch.lookbackBars);
        if(cross)items.push({
          id:stableId('cross-'+cross.direction,l.scope||'X',l.price),type:'marker',shape:cross.shape,time:cross.bar.time,price:roundPrice(l.price,tick),
          text:'',hoverText:'close '+cross.direction+' '+l.label,pane:0,source:l.source||'exact'
        });
      }
    }
    return items;
  }

  function quarterNumber(key){const m=String(key).match(/Q([1-4])$/);return m?Number(m[1]):null;}
  function yearFromKey(key){return Number(String(key).slice(0,4));}

  function periodLevels(stat,labelPrefix,scope,color,tickSize){
    if(!stat||!stat.complete||!stat.full)return[];
    const style=color==='#4fc3f7'?'solid':'dashed';
    return[
      {scope,label:labelPrefix+' VWAP',price:roundPrice(stat.vwap,tickSize),from:stat.end,source:'exact',color:scope==='PQ'?'#2e7d32':(color||'#e6e6e6'),style:scope==='PQ'?'solid':style},
      {scope,label:labelPrefix+' VAH',price:roundPrice(stat.upper,tickSize),from:stat.end,source:'exact',color:color||'#e6e6e6',style},
      {scope,label:labelPrefix+' VAL',price:roundPrice(stat.lower,tickSize),from:stat.end,source:'exact',color:color||'#e6e6e6',style}
    ];
  }

  function p1Candidates(input){
    const quarters=input.quarterStats||[],months=input.monthStats||[],last=input.bars[input.bars.length-1];
    if(!last)return[];
    const now=new Date(last.time*1000),year=now.getUTCFullYear(),py=year-1;
    const completeQ=quarters.filter(q=>q.complete&&q.full&&q.end<=last.time+(input.intervalSec||3600));
    const previous=completeQ.length?completeQ[completeQ.length-1]:null;
    const levels=[];
    if(previous)levels.push(...periodLevels(previous,'PQ','PQ',null,input.context.tickSize));
    for(const q of completeQ){
      const y=yearFromKey(q.key),n=quarterNumber(q.key);
      if(y===year)levels.push(...periodLevels(q,'Q'+n,'Q'+n,null,input.context.tickSize));
      else if(y===py)levels.push(...periodLevels(q,'PY Q'+n,'PY_Q',null,input.context.tickSize));
    }
    for(const m of months){
      if(!m.complete||!m.full||yearFromKey(m.key)!==py)continue;
      const month=Number(String(m.key).slice(5,7));
      levels.push(...periodLevels(m,'PY '+MONTHS[month-1],'PY_M','#4fc3f7',input.context.tickSize));
    }
    return levels;
  }

  function buildP1(input,items){
    const quarters=input.quarterStats||[],last=input.bars[input.bars.length-1];
    const current=quarters.find(q=>q.start<=last.time&&last.time<q.end);
    if(current&&current.points.length){
      items.push({id:'auto:p1:vwap:'+current.key,type:'band',label:'Q VWAP',points:current.points.map(p=>[p.time,p.vwap,p.upper,p.lower]),color:'#5cb85c',fill:'rgba(190,196,208,0.10)',source:'exact'});
    }
    const levels=p1Candidates(input);
    items.push(...buildLevelAnnotations(levels,input.bars,{...input.context,maxLabels:6},input.config));
  }

  function buildTpo(input,items){
    const preset=input.preset,profiles=(input.tpoProfiles||[]).filter(p=>{
      const from=Number(input.context.visibleStartTime)||-Infinity,to=Number(input.context.visibleEndTime)||Infinity;
      return p.to>=from&&p.from<=to;
    });
    const tick=Number(input.context.tickSize)||0;
    const suffix=preset==='p2'?'M':'W';
    for(const p of profiles){
      items.push({
        id:'auto:'+preset+':tpo:'+p.key,type:'profile',kind:'tpo',from:p.from,to:p.to,periodEnd:p.periodEnd,binSize:p.binSize,rows:p.rows,
        poc:roundPrice(p.poc,tick),vah:roundPrice(p.vah,tick),val:roundPrice(p.val,tick),maxWidthBars:40,showLetters:false,
        pocLabel:p.complete?'POC ▸':'dPOC ▸',source:'exact'
      });
      for(const s of p.singlePrints||[])items.push({
        id:stableId('single',p.key,s.bottom),type:'zone',top:roundPrice(s.top,tick),bottom:roundPrice(s.bottom,tick),
        from:p.from,to:p.to,label:'single prints',border:'#f4f6fb',fill:'rgba(244,246,251,.06)',source:'exact'
      });
      if(!p.complete)continue;
      const refs=[
        {kind:'POC',price:p.poc,color:'#8b2b2b',style:'solid'},
        {kind:'VAH',price:p.vah,color:'#4fc3f7',style:'dotted'},
        {kind:'VAL',price:p.val,color:'#4fc3f7',style:'dotted'}
      ];
      for(const ref of refs){
        if(!Number.isFinite(Number(ref.price)))continue;
        const level={price:roundPrice(ref.price,tick),from:p.periodEnd};
        const cutoff=cutoffLevel(level,input.tpoBars||input.bars,(input.config.touch&&input.config.touch.toleranceTicks||0)*tick);
        items.push({
          id:stableId('untraded-'+ref.kind,p.key,level.price),type:'level',price:level.price,label:'n'+ref.kind+' '+suffix,
          from:p.periodEnd,to:cutoff,style:ref.style,color:ref.color,axisLabel:true,showLabel:true,source:'exact',group:'tpo'
        });
      }
    }
  }

  function buildP4(input,items){
    const bars=input.bars||[],last=bars[bars.length-1];if(!last)return;
    const py=new Date(last.time*1000).getUTCFullYear()-1,current=Number(input.context.currentPrice),tick=Number(input.context.tickSize)||0;
    const candidates=(input.monthStats||[]).filter(m=>m.complete&&m.full&&yearFromKey(m.key)===py).map(m=>({
      stat:m,distance:Math.abs(((m.upper+m.lower)/2)-current)
    })).sort((a,b)=>a.distance-b.distance||a.stat.start-b.stat.start);
    const n=Math.max(1,Number(input.config.zones&&input.config.zones.nearestN)||2);
    for(const {stat} of candidates.slice(0,n)){
      const month=Number(String(stat.key).slice(5,7));
      items.push({
        id:'auto:p4:py-month:'+stat.key,type:'zone',top:roundPrice(stat.upper,tick),bottom:roundPrice(stat.lower,tick),
        from:stat.end,to:null,label:'py '+MONTHS[month-1].toLowerCase(),border:'#4fc3f7',fill:'rgba(79,195,247,0.10)',group:'PY_M',source:'exact'
      });
    }
  }

  function buildPreset(input){
    const bars=input.bars||[],now=bars.length?bars[bars.length-1].time:0,items=[];
    if(input.preset==='p1')buildP1(input,items);
    else if(input.preset==='p2'||input.preset==='p3')buildTpo(input,items);
    else if(input.preset==='p4')buildP4(input,items);
    items.sort((a,b)=>String(a.id).localeCompare(String(b.id)));
    return{schema:'annotations-v1',symbol:input.symbol,market:input.market,interval:input.interval,generatedAt:new Date(Number(now)*1000).toISOString(),items};
  }

  global.OrderFlowAnnotate={
    stableId,filterLevels,mergeLevels,findTouch,findCross,cutoffNakedPoc,cutoffLevel,buildLevelAnnotations,
    periodLevels,p1Candidates,buildPreset,roundPrice
  };
})(typeof globalThis!=='undefined'?globalThis:window);
