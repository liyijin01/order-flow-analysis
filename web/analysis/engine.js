(function(global){
  'use strict';

  function finite(v){return Number.isFinite(Number(v));}
  function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
  function utcQuarterStart(time){
    const d=new Date(Number(time)*1000),m=Math.floor(d.getUTCMonth()/3)*3;
    return Date.UTC(d.getUTCFullYear(),m,1)/1000;
  }
  function previousQuarterStart(time){
    const q=utcQuarterStart(time),d=new Date(q*1000);
    return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-3,1)/1000;
  }
  function utcMonthStart(time){
    const d=new Date(Number(time)*1000);
    return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)/1000;
  }
  function previousMonthStart(time){
    const m=utcMonthStart(time),d=new Date(m*1000);
    return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-1,1)/1000;
  }
  function utcWeekStart(time){
    const d=new Date(Number(time)*1000),day=(d.getUTCDay()+6)%7;
    return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-day)/1000;
  }

  function weightedStats(bars){
    let sv=0,sp=0,sp2=0;
    for(const b of bars||[]){
      const v=Math.max(0,Number(b.volume)||0),p=(Number(b.high)+Number(b.low)+Number(b.close))/3;
      if(!(v>0)||!finite(p))continue;
      sv+=v;sp+=p*v;sp2+=p*p*v;
    }
    if(!(sv>0))return null;
    const vwap=sp/sv,variance=Math.max(0,sp2/sv-vwap*vwap),sigma=Math.sqrt(variance);
    return{vwap,sigma,upper:vwap+sigma,lower:vwap-sigma,volume:sv};
  }

  function anchoredVwapSeries(bars,anchor){
    let sv=0,sp=0;const out=[];
    for(const b of bars||[]){
      if(Number(b.time)<Number(anchor))continue;
      const v=Math.max(0,Number(b.volume)||0),p=(Number(b.high)+Number(b.low)+Number(b.close))/3;
      if(!(v>0)||!finite(p))continue;
      sv+=v;sp+=p*v;out.push({time:Number(b.time),value:sp/sv});
    }
    return out;
  }

  // D2-1: project a higher-frequency line onto display-bar timestamps only.
  function alignSeriesToBars(points,bars,intervalSec){
    const src=(points||[]).slice().sort((a,b)=>Number(a.time)-Number(b.time));
    const dst=(bars||[]).slice().sort((a,b)=>Number(a.time)-Number(b.time));
    const out=[];let j=0,last=null;const sec=Number(intervalSec)||0;
    for(const bar of dst){
      const closeExclusive=Number(bar.time)+sec;
      while(j<src.length&&Number(src[j].time)<closeExclusive){last=src[j];j++;}
      if(last)out.push({time:Number(bar.time),value:Number(last.value)});
    }
    return out;
  }

  function valueArea(rows,binSize,pct){
    const sorted=(rows||[]).map(r=>[Number(r[0]),Number(r[1])]).filter(r=>finite(r[0])&&finite(r[1])).sort((a,b)=>a[0]-b[0]);
    if(!sorted.length)return null;
    const total=sorted.reduce((a,r)=>a+r[1],0),size=Number(binSize)||1;
    let max=-Infinity,pocIndex=0;
    const midpoint=(sorted[0][0]+sorted[sorted.length-1][0]+size)/2;
    let best=Infinity;
    for(let i=0;i<sorted.length;i++){
      const v=sorted[i][1],dist=Math.abs((sorted[i][0]+size/2)-midpoint);
      if(v>max||(v===max&&dist<=best)){max=v;pocIndex=i;best=dist;}
    }
    let lo=pocIndex,hi=pocIndex,acc=sorted[pocIndex][1],target=total*(pct==null?.70:Number(pct));
    while(acc<target&&(lo>0||hi<sorted.length-1)){
      const up=hi<sorted.length-1?sorted[hi+1][1]:-1;
      const dn=lo>0?sorted[lo-1][1]:-1;
      if(up>=dn&&hi<sorted.length-1){hi++;acc+=sorted[hi][1];}
      else if(lo>0){lo--;acc+=sorted[lo][1];}
      else{hi++;acc+=sorted[hi][1];}
    }
    return{poc:sorted[pocIndex][0]+size/2,vah:sorted[hi][0]+size,val:sorted[lo][0],included:acc,total};
  }

  function approxVolumeProfile(bars,binSize){
    const size=Number(binSize)||1,bins=new Map();let sourceVolume=0;
    for(const b of bars||[]){
      const volume=Math.max(0,Number(b.volume)||0);sourceVolume+=volume;
      if(!(volume>0))continue;
      const lo=Math.floor(Number(b.low)/size),hi=Math.floor((Number(b.high)-Number.EPSILON)/size);
      const count=Math.max(1,hi-lo+1),per=volume/count;
      for(let i=lo;i<=hi;i++)bins.set(i,(bins.get(i)||0)+per);
    }
    const rows=Array.from(bins.entries()).sort((a,b)=>a[0]-b[0]).map(([i,v])=>[i*size,v]);
    const va=valueArea(rows,size,.70);
    return{binSize:size,rows,sourceVolume,...(va||{})};
  }

  function tpoProfile(bars,binSize){
    const size=Number(binSize)||1,bins=new Map();
    for(const b of bars||[]){
      const lo=Math.floor(Number(b.low)/size),hi=Math.floor((Number(b.high)-Number.EPSILON)/size);
      for(let i=lo;i<=hi;i++)bins.set(i,(bins.get(i)||0)+1);
    }
    const rows=Array.from(bins.entries()).sort((a,b)=>a[0]-b[0]).map(([i,v])=>[i*size,v]);
    const va=valueArea(rows,size,.70);
    return{binSize:size,rows,...(va||{})};
  }

  function exactProfile(profilePayload){
    if(!profilePayload||!profilePayload.profiles||!profilePayload.profiles.previous)return null;
    const p=profilePayload.profiles.previous,size=Number(profilePayload.binSize)||1;
    if(!p.complete||!Array.isArray(p.rows)||!p.rows.length)return null;
    const rows=p.rows.map(r=>[Number(r[0])*size,Number(r[1]||0)+Number(r[2]||0)]);
    const va=valueArea(rows,size,.70);
    if(!va)return null;
    let end=null;
    const days=p.expectedDays||p.days||[];
    if(days.length)end=Date.parse(days[days.length-1]+'T00:00:00Z')/1000+86400;
    return{...va,binSize:size,from:end,source:'exact',label:p.label,days:p.days||[],expectedDays:p.expectedDays||[]};
  }

  function profileIsFresh(profilePayload,lastTime){
    const p=profilePayload&&profilePayload.profiles&&profilePayload.profiles.previous;
    if(!p||!p.complete)return false;
    const expected=p.expectedDays||p.days||[];
    if(!expected.length)return false;
    const pwStart=utcWeekStart(lastTime)-7*86400;
    const expectedStart=new Date(pwStart*1000).toISOString().slice(0,10);
    return expected[0]===expectedStart;
  }

  function atr14(bars){
    const out=[];let a=0;
    for(let i=0;i<(bars||[]).length;i++){
      const b=bars[i],pc=i?Number(bars[i-1].close):Number(b.open);
      const tr=Math.max(Number(b.high)-Number(b.low),Math.abs(Number(b.high)-pc),Math.abs(Number(b.low)-pc));
      a=i<14?(a*i+tr)/(i+1):(a*13+tr)/14;out.push(a);
    }
    return out;
  }

  // Formation, invalidation and age are computed from closed bars only.
  function detectZones(closedBars,cfg){
    const list=(closedBars||[]).slice().sort((a,b)=>a.time-b.time),atr=atr14(list),zones=[];
    for(let i=20;i<list.length;i++){
      for(let n=1;n<=Number(cfg.impulseMaxBars||3);n++){
        if(i+n>list.length)break;
        const first=list[i],lastB=list[i+n-1],move=Number(lastB.close)-Number(first.open),A=atr[i-1];
        if(!(A>0)||Math.abs(move)<Number(cfg.impulseMinMoveAtr||1.5)*A)continue;
        let ok=true,delta=0;
        for(let k=i;k<i+n;k++){
          const b=list[k],body=Math.abs(Number(b.close)-Number(b.open)),range=Number(b.high)-Number(b.low);
          if(!(range>0)||body<Number(cfg.impulseMinBodyPct||.5)*range||Math.sign(Number(b.close)-Number(b.open))!==Math.sign(move)){ok=false;break;}
          delta+=2*Number(b.takerBuyBase||0)-Number(b.volume||0);
        }
        if(!ok||(cfg.requireDeltaAlign&&Math.sign(delta)!==Math.sign(move)))continue;
        let lo=Infinity,hi=-Infinity,count=0,start=null;
        for(let j=i-1;j>=Math.max(0,i-Number(cfg.baseMaxBars||5));j--){
          const b=list[j];
          if(Number(b.high)-Number(b.low)>Number(cfg.baseMaxRangeAtr||1)*A)break;
          lo=Math.min(lo,Number(b.low));hi=Math.max(hi,Number(b.high));count++;start=Number(b.time);
        }
        if(!count)continue;
        zones.push({
          id:'zone-'+Number(lastB.time)+'-'+(move>0?'demand':'supply'),
          type:move>0?'demand':'supply',from:start,created:Number(lastB.time),top:hi,bottom:lo,
          strength:Math.abs(move)/A,tested:false,valid:true,source:'exact'
        });
        break;
      }
    }
    for(const z of zones){
      for(const b of list){
        if(Number(b.time)<=z.created)continue;
        if(z.type==='demand'){
          if(Number(b.close)<z.bottom){z.valid=false;break;}
          if(Number(b.low)<=z.top)z.tested=true;
        }else{
          if(Number(b.close)>z.top){z.valid=false;break;}
          if(Number(b.high)>=z.bottom)z.tested=true;
        }
      }
      const createdIndex=list.findIndex(b=>Number(b.time)===z.created);
      z.ageBars=createdIndex>=0?list.length-1-createdIndex:Infinity;
    }
    return zones.filter(z=>z.valid&&z.ageBars<=Number(cfg.maxAgeBars||300));
  }

  function markZoneTouches(zones,bars){
    return(zones||[]).map(zone=>{
      const z={...zone};
      for(const b of bars||[]){
        if(Number(b.time)<=Number(z.created))continue;
        if(z.type==='demand'&&Number(b.low)<=Number(z.top))z.tested=true;
        if(z.type==='supply'&&Number(b.high)>=Number(z.bottom))z.tested=true;
      }
      return z;
    });
  }

  function zonesOverlap(a,b){return Math.min(a.top,b.top)>=Math.max(a.bottom,b.bottom);}
  function mergeZones(zones){
    const grouped={supply:[],demand:[]};
    for(const type of Object.keys(grouped)){
      const sorted=(zones||[]).filter(z=>z.type===type).slice().sort((a,b)=>a.bottom-b.bottom||a.created-b.created);
      for(const z of sorted){
        let hit=-1;
        for(let i=0;i<grouped[type].length;i++)if(zonesOverlap(grouped[type][i],z)){hit=i;break;}
        if(hit<0)grouped[type].push({...z});
        else{
          const a=grouped[type][hit];
          grouped[type][hit]={
            ...a,bottom:Math.min(a.bottom,z.bottom),top:Math.max(a.top,z.top),from:Math.min(a.from,z.from),
            created:Math.max(a.created,z.created),strength:Math.max(a.strength,z.strength),
            tested:!!a.tested&&!!z.tested,ageBars:Math.min(a.ageBars,z.ageBars)
          };
        }
      }
    }
    return grouped.supply.concat(grouped.demand);
  }

  function zoneState(z,current){
    const price=Number(current),bottom=Number(z.bottom),top=Number(z.top);
    if(bottom<=price&&price<=top)return{state:'inside',distancePct:0};
    if(z.type==='supply'){
      if(price<bottom)return{state:'ahead',distancePct:(bottom-price)/price*100};
      return{state:'breaking',distancePct:(price-top)/price*100};
    }
    if(price>top)return{state:'ahead',distancePct:(price-top)/price*100};
    return{state:'breaking',distancePct:(bottom-price)/price*100};
  }

  function selectZones(zones,current,cfg){
    const price=Number(current),maxDist=Number(cfg.maxDistancePct||20),per=Math.max(1,Number(cfg.perSide||2));
    const supply=[],demand=[];
    for(const z of mergeZones(zones)){
      const st=zoneState(z,price);
      if(st.distancePct>maxDist)continue;
      const item={...z,zoneState:st.state,distancePct:st.distancePct};
      (z.type==='supply'?supply:demand).push(item);
    }
    const order=(a,b)=>{
      const sa=a.zoneState==='inside'?0:(a.zoneState==='ahead'?1:2);
      const sb=b.zoneState==='inside'?0:(b.zoneState==='ahead'?1:2);
      return sa-sb||a.distancePct-b.distancePct||Number(b.strength)-Number(a.strength);
    };
    supply.sort(order);demand.sort(order);
    return supply.slice(0,per).concat(demand.slice(0,per));
  }

  function rangeOverlapRatio(a,b){
    const inter=Math.max(0,Math.min(a.top,b.top)-Math.max(a.bottom,b.bottom));
    const small=Math.min(a.top-a.bottom,b.top-b.bottom);
    return small>0?inter/small:0;
  }

  function suppressValueAreas(areas,overlapPct,maxCount){
    const rank={PQ:3,PM:2,PW:1};
    const sorted=(areas||[]).slice().sort((a,b)=>(rank[b.scope]||0)-(rank[a.scope]||0));
    const out=[];
    for(const a of sorted){
      if(out.some(b=>rangeOverlapRatio(a,b)>=Number(overlapPct||70)/100))continue;
      out.push(a);
      if(out.length>=Number(maxCount||3))break;
    }
    return out;
  }

  function filterValueAreas(areas,visibleMin,visibleMax,padPct,overlapPct){
    const span=Math.max(1e-12,Number(visibleMax)-Number(visibleMin)),pad=span*Number(padPct||0)/100;
    return suppressValueAreas((areas||[]).filter(a=>a.top>=visibleMin-pad&&a.bottom<=visibleMax+pad),overlapPct,3);
  }

  function inPriceView(price,viewMin,viewMax,padPct){
    const span=Math.max(1e-12,Number(viewMax)-Number(viewMin)),pad=span*Number(padPct||0)/100;
    return Number(price)>=Number(viewMin)-pad&&Number(price)<=Number(viewMax)+pad;
  }

  function zoneIntersectsView(zone,viewMin,viewMax,padPct){
    const span=Math.max(1e-12,Number(viewMax)-Number(viewMin)),pad=span*Number(padPct||0)/100;
    return Number(zone.top)>=Number(viewMin)-pad&&Number(zone.bottom)<=Number(viewMax)+pad;
  }

  function wasZoneTouched(bars,from,bottom,top){
    return (bars||[]).some(b=>Number(b.time)>=Number(from)&&Number(b.high)>=Number(bottom)&&Number(b.low)<=Number(top));
  }

  function isPocNaked(price,from,bars){
    for(const b of bars||[]){
      if(Number(b.time)<Number(from))continue;
      if(Number(b.low)<=Number(price)&&Number(price)<=Number(b.high))return false;
    }
    return true;
  }

  function selectNakedPocs(items,current,maxCount){
    return (items||[]).filter(Boolean).sort((a,b)=>Math.abs(a.price-current)-Math.abs(b.price-current)).slice(0,Number(maxCount)||2);
  }

  function mergeKeyLevels(items,tick){
    const t=Math.max(1e-12,Number(tick)||1),src=(items||[]).filter(x=>finite(x&&x.price)).slice().sort((a,b)=>Number(a.price)-Number(b.price)||String(a.label).localeCompare(String(b.label))),groups=[];
    for(const item of src){
      const last=groups[groups.length-1];
      if(last&&Math.abs(Number(item.price)-Number(last.price))<t){
        const rows=last._rows.concat([item]),avg=rows.reduce((sum,x)=>sum+Number(x.price),0)/rows.length;
        last._rows=rows;last.price=roundToTick(avg,t);
        last.label=Array.from(new Set(rows.map(x=>String(x.label)))).join(' · ');
        last.definition=Array.from(new Set(rows.map(x=>String(x.definition||'')))).filter(Boolean).join(' + ');
        last.keyKind=rows.every(x=>x.kind==='py-month')?'py-month':'quarter';
        last.id=rows.map(x=>String(x.id)).sort().join('+');
      }else groups.push({...item,price:Number(item.price),keyKind:item.kind==='py-month'?'py-month':'quarter',_rows:[item]});
    }
    return groups.map(({_rows,...row})=>row);
  }

  function selectKeyLevels(items,current,viewMin,viewMax,padPct,tick,maxCount,previousQuarter,maxMonthly,minGapPct,reservedPrices,minGapPx,viewHeightPx){
    const pq=Number(previousQuarter),filtered=(items||[]).filter(item=>{
      const start=Date.parse(String(item.periodStart||''))/1000;
      return !(finite(pq)&&finite(start)&&Math.abs(start-pq)<1);
    });
    const merged=mergeKeyLevels(filtered,tick),eligible=merged.filter(x=>inPriceView(x.price,viewMin,viewMax,padPct));
    const byDistance=(a,b)=>Math.abs(Number(a.price)-Number(current))-Math.abs(Number(b.price)-Number(current))||Number(a.price)-Number(b.price);
    const quarters=eligible.filter(x=>x.keyKind!=='py-month').sort(byDistance);
    const monthly=eligible.filter(x=>x.keyKind==='py-month').sort(byDistance);
    const limit=Math.max(0,Number(maxCount)||0),monthLimit=Math.max(0,Number(maxMonthly)||0);
    const span=Math.max(1e-12,Number(viewMax)-Number(viewMin));
    const pctGap=span*Math.max(0,Number(minGapPct)||0)/100,pad=Math.max(0,Number(padPct)||0)/100;
    const paddedSpan=span*(1+2*pad),height=Number(viewHeightPx),pxGap=finite(height)&&height>0?paddedSpan*Math.max(0,Number(minGapPx)||0)/height:0;
    const minGap=Math.max(pctGap,pxGap);
    const selected=[],reserved=(reservedPrices||[]).map(Number).filter(finite);
    const canAdd=item=>{
      const p=Number(item.price);
      return reserved.every(x=>Math.abs(p-x)>=minGap)&&selected.every(x=>Math.abs(p-Number(x.price))>=minGap);
    };
    for(const item of quarters){
      if(selected.length>=limit)break;
      if(canAdd(item))selected.push(item);
    }
    let monthlyCount=0;
    for(const item of monthly){
      if(selected.length>=limit||monthlyCount>=monthLimit)break;
      if(!canAdd(item))continue;
      selected.push(item);monthlyCount++;
    }
    const ids=new Set(selected.map(x=>x.id));
    return{all:merged.map(x=>({...x,offView:!ids.has(x.id)})),selected:selected.map(x=>({...x,offView:false}))};
  }

  function profileExtensions(periods,sides){
    const src=(periods||[]).filter(x=>x&&x.complete===true).map(x=>({...x,_start:Date.parse(String(x.start||''))/1000})).filter(x=>finite(x._start)).sort((a,b)=>a._start-b._start),out=[];
    for(let i=0;i<src.length;i++){
      const p=src[i];
      for(const side of sides||['vah','val','poc']){
        const price=Number(p[side]);if(!finite(price))continue;
        let touch=null;
        for(let j=i+1;j<src.length;j++){
          const q=src[j];if(Number(q.low)<=price&&price<=Number(q.high)){touch=q;break;}
        }
        out.push({period:p,side,price,from:p._start,to:touch?touch._start:null,naked:!touch,touchedBy:touch||null});
      }
    }
    return out;
  }
  function selectProfileValueBox(periods,current){
    const price=Number(current);
    return(periods||[]).filter(p=>p&&p.complete===true&&finite(p.val)&&finite(p.vah)&&Number(p.val)<=price&&price<=Number(p.vah))
      .slice().sort((a,b)=>Date.parse(String(b.start||''))-Date.parse(String(a.start||'')))[0]||null;
  }

  function capTableRows(rows,maxRows){
    const src=(rows||[]).slice(),limit=Math.max(1,Number(maxRows)||16);
    if(src.length<=limit)return src;
    const kept=src.slice(0,limit-1),hidden=src.length-kept.length;
    kept.push({type:'另有 '+hidden+' 条',low:null,high:null,distance:null,status:'省略',period:'',source:'',missing:false,summary:true});
    return kept;
  }

  function axisLabelSelection(candidates,coordinateFn,minGap,reserved){
    const gap=Number(minGap||14);
    const blocked=(reserved||[]).map(Number).filter(finite);
    const rows=(candidates||[]).map(c=>({...c,y:Number(coordinateFn(c.price))})).filter(c=>finite(c.y));
    rows.sort((a,b)=>(Number(b.priority)||0)-(Number(a.priority)||0)||Math.abs(Number(a.price)-Number(a.currentPrice||a.price))-Math.abs(Number(b.price)-Number(b.currentPrice||b.price))||a.y-b.y);
    const accepted=[];
    for(const row of rows){
      if(blocked.some(y=>Math.abs(y-row.y)<gap))continue;
      if(accepted.every(a=>Math.abs(a.y-row.y)>=gap))accepted.push(row);
    }
    const ids=new Set(accepted.map(x=>x.id));
    return rows.map(r=>({...r,visible:ids.has(r.id)}));
  }

  function regionLabelLayout(items,minGap,maxShift,height){
    const rows=(items||[]).map(x=>({...x,originalY:Number(x.targetY),y:Number(x.targetY)})).filter(x=>finite(x.y)).sort((a,b)=>a.y-b.y);
    let prev=-Infinity;
    for(const r of rows){
      if(r.y-prev<Number(minGap||14))r.y=prev+Number(minGap||14);
      if(Math.abs(r.y-r.originalY)>Number(maxShift||24)||r.y<10||r.y>Number(height||1e9)-4)r.visible=false;
      else{r.visible=true;prev=r.y;}
    }
    return rows;
  }

  function roundToTick(value,tick){
    const t=Number(tick);if(!(t>0))return Number(value);
    return Math.round(Number(value)/t)*t;
  }

  global.OrderFlowAnalysisEngine={
    utcQuarterStart,previousQuarterStart,utcMonthStart,previousMonthStart,utcWeekStart,
    weightedStats,anchoredVwapSeries,alignSeriesToBars,valueArea,approxVolumeProfile,tpoProfile,exactProfile,profileIsFresh,
    atr14,detectZones,markZoneTouches,mergeZones,zoneState,selectZones,rangeOverlapRatio,suppressValueAreas,filterValueAreas,inPriceView,zoneIntersectsView,
    wasZoneTouched,isPocNaked,selectNakedPocs,mergeKeyLevels,selectKeyLevels,profileExtensions,selectProfileValueBox,capTableRows,axisLabelSelection,regionLabelLayout,roundToTick
  };
})(typeof globalThis!=='undefined'?globalThis:window);
