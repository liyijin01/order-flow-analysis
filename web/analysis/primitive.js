(function(global){
  'use strict';

  const E=global.OrderFlowAnalysisEngine;

  class AxisLabelView{
    constructor(owner,candidate){this.owner=owner;this.candidate=candidate;}
    coordinate(){
      if(!this.owner.series)return-1000;
      const y=this.owner.series.priceToCoordinate(Number(this.candidate.price));
      return y==null?-1000:Number(y);
    }
    text(){return this.owner.formatPrice(this.candidate.price);}
    textColor(){return'#111827';}
    backColor(){return this.candidate.color||'#e5e7eb';}
    visible(){return this.owner.axisVisible(this.candidate.id);}
    tickVisible(){return true;}
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
        const color=r.border||'#e5e7eb';
        if(r.type==='value'){
          out.push({id:r.id+':top',price:r.top,priority:2,color,currentPrice:current});
          out.push({id:r.id+':bottom',price:r.bottom,priority:2,color,currentPrice:current});
        }else if(r.type==='supply'){
          out.push({id:r.id+':near',price:r.bottom,priority:3,color,currentPrice:current});
        }else if(r.type==='demand'){
          out.push({id:r.id+':near',price:r.top,priority:3,color,currentPrice:current});
        }
      }
      for(const l of this.model.levels||[])out.push({id:l.id+':price',price:l.price,priority:1,color:l.axisColor||l.color||'#e5e7eb',currentPrice:current});
      return out;
    }
    axisLayout(){
      if(!this.series)return[];
      const currentY=this.series.priceToCoordinate(Number(this.model.currentPrice));
      const reserved=currentY==null?[]:[Number(currentY)];
      return E.axisLabelSelection(this.axisCandidates(),p=>this.series.priceToCoordinate(Number(p)),Number(this.model.axisMinGap)||14,reserved);
    }
    axisVisible(id){const row=this.axisLayout().find(x=>x.id===id);return!!(row&&row.visible);}
    priceAxisViews(){return this.axisCandidates().map(c=>new AxisLabelView(this,c));}

    autoscaleInfo(){
      const vals=[];
      for(const r of this.model.regions||[])vals.push(Number(r.bottom),Number(r.top));
      for(const l of this.model.levels||[])vals.push(Number(l.price));
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
    label(ctx,text,x,y,color){
      if(!text)return;ctx.save();ctx.font='600 12px -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif';
      ctx.textAlign='right';ctx.textBaseline='middle';ctx.fillStyle=color||'#e7eaf0';
      ctx.shadowColor='rgba(27,33,48,.95)';ctx.shadowBlur=4;ctx.fillText(String(text),x,y);ctx.restore();
    }

    draw(ctx,size){
      const regions=this.model.regions||[],levels=this.model.levels||[],labelTargets=[];
      for(const r of regions){
        let x1=this.x(r.from,size.width),yt=this.y(r.top),yb=this.y(r.bottom);
        if(yt==null||yb==null)continue;if(x1==null)x1=0;
        const left=Math.max(0,Math.min(size.width,x1)),right=size.width,top=Math.min(yt,yb),bottom=Math.max(yt,yb);
        ctx.save();ctx.fillStyle=r.fill||'rgba(96,165,250,.10)';ctx.fillRect(left,top,Math.max(0,right-left),Math.max(1,bottom-top));
        ctx.strokeStyle=r.border||'#60a5fa';ctx.lineWidth=1;this.lineStyle(ctx,r.borderStyle||(r.tested?'dashed':'solid'));
        ctx.strokeRect(left+.5,top+.5,Math.max(0,right-left-1),Math.max(1,bottom-top-1));ctx.restore();
        const outside=(bottom-top)<16,targetY=outside?top-6:top+10;
        labelTargets.push({id:r.id,text:r.label,x:right-8,targetY,color:r.border||'#e7eaf0',priority:r.type==='value'?2:3});
      }
      for(const l of levels){
        let x1=this.x(l.from,size.width),y=this.y(l.price);if(y==null)continue;if(x1==null)x1=0;
        ctx.save();ctx.strokeStyle=l.color||'#e7eaf0';ctx.lineWidth=l.width||1.3;this.lineStyle(ctx,l.style||'solid');
        ctx.beginPath();ctx.moveTo(Math.max(0,x1),y);ctx.lineTo(size.width,y);ctx.stroke();ctx.restore();
        labelTargets.push({id:l.id,text:l.label,x:size.width-8,targetY:y-8,color:l.color||'#e7eaf0',priority:1});
      }
      const layout=E.regionLabelLayout(labelTargets,Number(this.model.textMinGap)||14,Number(this.model.textMaxShift)||24,size.height);
      for(const row of layout)if(row.visible)this.label(ctx,row.text,row.x,row.y,row.color);
    }

    debugAxisLabels(){
      return this.axisLayout().map(x=>{
        const actual=this.series?this.series.priceToCoordinate(Number(x.price)):null;
        return{id:x.id,price:x.price,visible:x.visible,coordinate:x.y,priceCoordinate:actual,diff:actual==null?null:Math.abs(Number(actual)-Number(x.y)),priority:x.priority};
      });
    }
  }

  global.OrderFlowAnalysisPrimitive={AnalysisBoardPrimitive};
})(typeof globalThis!=='undefined'?globalThis:window);
