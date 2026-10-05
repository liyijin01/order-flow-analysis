(function(global){
  'use strict';

  const E=global.OrderFlowAnalysisEngine;

  function mergeProfileRows(rows,rowSize,pixelsPerRow,minPx){
    const src=(rows||[]).map(r=>[Number(r[0]),Number(r[1])]).filter(r=>Number.isFinite(r[0])&&Number.isFinite(r[1])).sort((a,b)=>a[0]-b[0]);
    if(!src.length)return[];
    const size=Math.max(1e-12,Number(rowSize)||1),px=Math.max(1e-12,Number(pixelsPerRow)||1),need=Math.max(1,Math.ceil((Number(minPx)||2)/px)),out=[];
    for(let i=0;i<src.length;i+=need){
      const part=src.slice(i,i+need),bottom=part[0][0],top=part[part.length-1][0]+size;
      let count=0;for(const r of part)count+=Number(r[1])||0;
      out.push({bottom,top,mid:(bottom+top)/2,count,rows:part.length});
    }
    return out;
  }

  class AxisLabelView{
    constructor(owner,candidate){this.owner=owner;this.candidate=candidate;}
    coordinate(){
      if(Number.isFinite(Number(this.candidate.coordinate)))return Number(this.candidate.coordinate);
      if(!this.owner.series)return-1000;
      const y=this.owner.series.priceToCoordinate(Number(this.candidate.price));
      return y==null?-1000:Number(y);
    }
    text(){return this.candidate.text!=null?String(this.candidate.text):this.owner.formatPrice(this.candidate.price);}
    textColor(){return this.candidate.textColor||'#111827';}
    backColor(){return this.candidate.color||'#e5e7eb';}
    visible(){return this.candidate.forceVisible===true?true:this.owner.axisVisible(this.candidate.id);}
    tickVisible(){return this.candidate.tickVisible!==false;}
  }

  class AnalysisBoardPrimitive{
    constructor(model){
      this.model=model||{};this.chart=null;this.series=null;this.requestUpdate=null;
      this._view={zOrder:()=> 'bottom',renderer:()=>({draw:(target)=>target.useMediaCoordinateSpace(scope=>this.draw(scope.context,scope.mediaSize))})};
    }
    attached(params){this.chart=params.chart;this.series=params.series;this.requestUpdate=params.requestUpdate;}
    detached(){this.chart=null;this.series=null;this.requestUpdate=null;}
    paneViews(){return[this._view];}
    updateAllViews(){}
    setModel(model){this.model=model||{};if(this.requestUpdate)this.requestUpdate();}
    setCountdown(countdown){this.model={...this.model,countdown:countdown||null};if(this.requestUpdate)this.requestUpdate();}
    formatPrice(price){
      return this.model.priceFormatter?this.model.priceFormatter(Number(price)):Number(price).toLocaleString();
    }
    displayTime(time){return Number(time)+(Number(this.model.timeOffsetSec)||0);}
    x(time,width){
      if(time==null)return width;if(!this.chart)return null;
      const scale=this.chart.timeScale(),t=this.displayTime(time);
      const direct=scale.timeToCoordinate(t);if(direct!=null)return Number(direct);
      const idx=scale.timeToIndex(t,true);if(idx!=null){const x=scale.logicalToCoordinate(idx);if(x!=null)return Number(x);}
      const bars=this.model.bars||[];if(!bars.length)return null;
      const sec=Number(this.model.intervalSec)||3600,first=bars[0],last=bars[bars.length-1];
      const firstT=this.displayTime(first.time),lastT=this.displayTime(last.time);
      if(t<firstT){const fi=scale.timeToIndex(firstT,true);const x=fi==null?0:scale.logicalToCoordinate(fi);return x==null?0:Number(x);}
      if(t>lastT){const li=scale.timeToIndex(lastT,true);if(li==null)return width;const x=scale.logicalToCoordinate(Number(li)+(t-lastT)/sec);return x==null?width:Number(x);}
      return null;
    }
    y(price){if(!this.series)return null;const y=this.series.priceToCoordinate(Number(price));return y==null?null:Number(y);}

    axisCandidates(){
      const out=[],current=Number(this.model.currentPrice)||0;
      for(const r of this.model.regions||[]){
        if(r.axisLabel===false)continue;
        const color=r.axisColor||r.border||'#e5e7eb',textColor=r.axisTextColor||'#111827';
        if(r.type==='value'){
          out.push({id:r.id+':top',price:r.top,priority:2,color,textColor,currentPrice:current});
          out.push({id:r.id+':bottom',price:r.bottom,priority:2,color,textColor,currentPrice:current});
        }else if(r.type==='supply'){
          out.push({id:r.id+':near',price:r.bottom,priority:3,color,currentPrice:current});
        }else if(r.type==='demand'){
          out.push({id:r.id+':near',price:r.top,priority:3,color,currentPrice:current});
        }
      }
      for(const l of this.model.levels||[])if(l.axisLabel!==false)out.push({id:l.id+':price',price:l.price,priority:1,color:l.axisColor||l.color||'#e5e7eb',textColor:l.axisTextColor||'#111827',currentPrice:current});
      return out;
    }
    countdownCandidate(){
      const c=this.model.countdown;if(!c||!c.text||!this.series)return null;
      const currentY=this.series.priceToCoordinate(Number(this.model.currentPrice));if(currentY==null)return null;
      const gap=Number(this.model.axisMinGap)||18,offset=Math.max(gap,Number(c.offsetPx)||gap);
      return{id:'countdown',coordinate:Number(currentY)+offset,text:String(c.text),color:c.color||'#e6e9ef',textColor:c.textColor||'#111827',tickVisible:false,forceVisible:true,countdown:true};
    }
    axisLayout(){
      if(!this.series)return[];
      const currentY=this.series.priceToCoordinate(Number(this.model.currentPrice)),countdown=this.countdownCandidate();
      const reserved=currentY==null?[]:[Number(currentY)];if(countdown)reserved.push(Number(countdown.coordinate));
      return E.axisLabelSelection(this.axisCandidates(),p=>this.series.priceToCoordinate(Number(p)),Number(this.model.axisMinGap)||14,reserved);
    }
    axisVisible(id){const row=this.axisLayout().find(x=>x.id===id);return!!(row&&row.visible);}
    priceAxisViews(){
      const out=this.axisCandidates().map(c=>new AxisLabelView(this,c)),countdown=this.countdownCandidate();
      if(countdown)out.push(new AxisLabelView(this,countdown));return out;
    }

    autoscaleInfo(){
      const vals=[];
      for(const p of this.model.profiles||[])vals.push(Number(p.low),Number(p.high),Number(p.val),Number(p.vah),Number(p.poc));
      for(const r of this.model.regions||[])vals.push(Number(r.bottom),Number(r.top));
      for(const l of this.model.levels||[])vals.push(Number(l.price));
      for(const c of this.model.curves||[])for(const p of c.points||[])vals.push(Number(p.value));
      const lo=Number(this.model.autoscaleMin),hi=Number(this.model.autoscaleMax);
      let min=Infinity,max=-Infinity;
      for(const raw of vals){
        if(!Number.isFinite(raw))continue;
        let n=raw;
        if(Number.isFinite(lo)&&n<lo)n=lo;
        if(Number.isFinite(hi)&&n>hi)n=hi;
        if(n<min)min=n;if(n>max)max=n;
      }
      if(!Number.isFinite(min)||!Number.isFinite(max))return null;
      return{priceRange:{minValue:min,maxValue:max}};
    }

    lineStyle(ctx,style){if(style==='dashed')ctx.setLineDash([7,5]);else if(style==='dotted')ctx.setLineDash([2,4]);else ctx.setLineDash([]);}
    label(ctx,text,x,y,color,size,weight){
      if(!text)return;ctx.save();ctx.font=String(weight||600)+' '+String(size||12)+'px -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif';
      ctx.textAlign='right';ctx.textBaseline='middle';ctx.fillStyle=color||'#e7eaf0';
      ctx.shadowColor='rgba(27,33,48,.95)';ctx.shadowBlur=4;ctx.fillText(String(text),x,y);ctx.restore();
    }
    curveLabel(ctx,text,x,y,color){
      if(!text)return;ctx.save();ctx.font='11px ui-monospace,SFMono-Regular,Menlo,monospace';ctx.textAlign='left';ctx.textBaseline='middle';
      ctx.fillStyle=color||'#aeb7c8';ctx.shadowColor='rgba(27,33,48,.95)';ctx.shadowBlur=4;ctx.fillText(String(text),x,y);ctx.restore();
    }
    curvePath(ctx,points,size){
      let started=false,drew=false;
      for(const p of points||[]){
        if(!Number.isFinite(Number(p.value))){started=false;continue;}
        const x=this.x(p.time,size.width),y=this.y(p.value);if(x==null||y==null){started=false;continue;}
        if(!started){ctx.moveTo(x,y);started=true;}else ctx.lineTo(x,y);drew=true;
      }
      return started||drew;
    }

    profileRows(profile){
      const size=Number(profile.rowSize)||1,y1=this.y(Number(profile.val)||0),y2=this.y((Number(profile.val)||0)+size);
      const px=y1==null||y2==null?2:Math.abs(Number(y2)-Number(y1));
      return mergeProfileRows(profile.rows,size,px,2);
    }
    drawProfiles(ctx,size){
      for(const p of this.model.profiles||[]){
        let x1=this.x(p.start,size.width),x2=this.x(p.end,size.width);if(x1==null)x1=0;if(x2==null)x2=size.width;
        const left=Math.max(0,Math.min(size.width,x1)),periodWidth=Math.max(1,Math.min(size.width,x2)-left),rows=this.profileRows(p);
        let maxCount=0;for(const row of rows)if(Number(row.count)>maxCount)maxCount=Number(row.count);
        if(!(maxCount>0))continue;
        for(const row of rows){
          const yt=this.y(row.top),yb=this.y(row.bottom);if(yt==null||yb==null)continue;
          const top=Math.min(yt,yb),bottom=Math.max(yt,yb),width=periodWidth*.85*(Number(row.count)/maxCount);
          const containsPoc=Number(p.poc)>=Number(row.bottom)&&Number(p.poc)<Number(row.top);
          const inVa=Number(row.mid)>=Number(p.val)&&Number(row.mid)<=Number(p.vah);
          ctx.save();ctx.fillStyle=containsPoc?(p.colors&&p.colors.poc||'#ffeb3b'):(inVa?(p.colors&&p.colors.value||'rgba(64,160,190,.85)'):(p.colors&&p.colors.outside||'rgba(150,150,150,.6)'));
          ctx.fillRect(left,top,Math.max(1,width),Math.max(1,bottom-top));ctx.restore();
        }
      }
    }
    draw(ctx,size){
      const regions=this.model.regions||[],levels=this.model.levels||[],curves=this.model.curves||[],labelTargets=[];
      this.drawProfiles(ctx,size);
      for(const c of curves){
        const points=c.points||[];if(!points.some(p=>Number.isFinite(Number(p.value))))continue;
        if(c.underlay&&Number(c.underlayWidth)>0){ctx.save();ctx.strokeStyle=c.underlay;ctx.lineWidth=Number(c.underlayWidth);ctx.lineJoin='round';ctx.lineCap='round';ctx.beginPath();if(this.curvePath(ctx,points,size))ctx.stroke();ctx.restore();}
        ctx.save();ctx.strokeStyle=c.color||'#4caf50';ctx.lineWidth=Number(c.width)||1.5;ctx.lineJoin='round';ctx.lineCap='round';ctx.beginPath();if(this.curvePath(ctx,points,size))ctx.stroke();ctx.restore();
        if(c.label){const last=points[points.length-1],x=this.x(last.time,size.width),y=this.y(last.value);if(x!=null&&y!=null)labelTargets.push({id:c.id,text:c.label,x:x+8,targetY:y,color:c.labelColor||c.color||'#aeb7c8',priority:2,curve:true});}
      }
      for(const r of regions){
        let x1=this.x(r.from,size.width),x2=r.to==null?size.width:this.x(r.to,size.width),yt=this.y(r.top),yb=this.y(r.bottom);
        if(yt==null||yb==null)continue;if(x1==null)x1=0;if(x2==null)x2=size.width;
        const left=Math.max(0,Math.min(size.width,x1)),right=Math.max(left,Math.min(size.width,x2)),top=Math.min(yt,yb),bottom=Math.max(yt,yb);
        ctx.save();ctx.fillStyle=r.fill||'rgba(96,165,250,.10)';ctx.fillRect(left,top,Math.max(0,right-left),Math.max(1,bottom-top));
        ctx.strokeStyle=r.border||'#60a5fa';ctx.lineWidth=1;
        if(r.topStyle||r.bottomStyle){
          this.lineStyle(ctx,'solid');ctx.beginPath();ctx.moveTo(left,top);ctx.lineTo(left,bottom);ctx.moveTo(right,top);ctx.lineTo(right,bottom);ctx.stroke();
          this.lineStyle(ctx,r.topStyle||'solid');ctx.beginPath();ctx.moveTo(left,top);ctx.lineTo(right,top);ctx.stroke();
          this.lineStyle(ctx,r.bottomStyle||'solid');ctx.beginPath();ctx.moveTo(left,bottom);ctx.lineTo(right,bottom);ctx.stroke();
        }else{
          this.lineStyle(ctx,r.borderStyle||(r.tested?'dashed':'solid'));ctx.strokeRect(left+.5,top+.5,Math.max(0,right-left-1),Math.max(1,bottom-top-1));
        }
        ctx.restore();
        const outside=(bottom-top)<16,targetY=outside?top-6:top+10;
        if(r.label)labelTargets.push({id:r.id,text:r.label,x:right-8,targetY,color:r.labelColor||r.border||'#e7eaf0',fontSize:r.labelSize||12,fontWeight:r.labelWeight||600,priority:r.type==='value'?2:3});
      }
      for(const l of levels){
        let x1=this.x(l.from,size.width),x2=l.to==null?size.width:this.x(l.to,size.width),y=this.y(l.price);if(y==null)continue;if(x1==null)x1=0;if(x2==null)x2=size.width;
        if(l.draw!==false){ctx.save();ctx.strokeStyle=l.color||'#e7eaf0';ctx.lineWidth=l.width||1.3;this.lineStyle(ctx,l.style||'solid');
        ctx.beginPath();ctx.moveTo(Math.max(0,x1),y);ctx.lineTo(Math.max(0,Math.min(size.width,x2)),y);ctx.stroke();ctx.restore();}
        if(l.label)labelTargets.push({id:l.id,text:l.label,x:Math.max(0,Math.min(size.width,x2))-8,targetY:y-8,color:l.color||'#e7eaf0',fontSize:l.labelSize||12,fontWeight:l.labelWeight||600,priority:1});
      }
      const layout=E.regionLabelLayout(labelTargets,Number(this.model.textMinGap)||14,Number(this.model.textMaxShift)||24,size.height);
      for(const row of layout)if(row.visible){if(row.curve)this.curveLabel(ctx,row.text,row.x,row.y,row.color);else this.label(ctx,row.text,row.x,row.y,row.color,row.fontSize,row.fontWeight);}
    }

    debugProfiles(){return(this.model.profiles||[]).map(p=>({start:p.start,end:p.end,rows:this.profileRows(p),vah:p.vah,val:p.val,poc:p.poc,forming:!!p.forming}));}
    debugAxisLabels(){
      const out=this.axisLayout().map(x=>{
        const actual=this.series?this.series.priceToCoordinate(Number(x.price)):null;
        return{id:x.id,price:x.price,visible:x.visible,coordinate:x.y,priceCoordinate:actual,diff:actual==null?null:Math.abs(Number(actual)-Number(x.y)),priority:x.priority,color:x.color,textColor:x.textColor};
      });
      const countdown=this.countdownCandidate();if(countdown)out.push({id:countdown.id,text:countdown.text,visible:true,coordinate:countdown.coordinate,priceCoordinate:null,diff:null,priority:99,color:countdown.color,textColor:countdown.textColor,countdown:true});
      return out;
    }
  }

  global.OrderFlowAnalysisPrimitive={AnalysisBoardPrimitive,mergeProfileRows};
})(typeof globalThis!=='undefined'?globalThis:window);
