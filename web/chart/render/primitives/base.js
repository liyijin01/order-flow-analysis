(function(global){
  'use strict';

  class AnnotationPrimitiveBase {
    constructor(item){
      this.item=item;this.chart=null;this.series=null;this.requestUpdate=null;this.context={bars:[],intervalSec:3600,autoscale:true};
      this._lastClamp=false;
      this._view={zOrder:()=>this.zOrder(),renderer:()=>({draw:(target)=>target.useMediaCoordinateSpace((scope)=>this.draw(scope.context,scope.mediaSize))})};
    }
    setContext(context){this.context={...this.context,...(context||{})};}
    attached(params){this.chart=params.chart;this.series=params.series;this.requestUpdate=params.requestUpdate;}
    detached(){this.chart=null;this.series=null;this.requestUpdate=null;}
    paneViews(){return [this._view];}
    updateAllViews(){}
    zOrder(){return 'top';}
    normalizedTime(time){
      const sec=this.context.intervalSec||3600;
      return Math.floor(Number(time)/sec)*sec;
    }
    x(time,width){
      this._lastClamp=false;
      if(time==null)return width;
      if(!this.chart)return null;
      const scale=this.chart.timeScale(),t=this.normalizedTime(time),bars=this.context.bars||[];
      let index=scale.timeToIndex(t,true);
      if(index!=null){
        const x=scale.logicalToCoordinate(index);
        return x==null?null:Number(x);
      }
      if(!bars.length)return null;
      const first=bars[0],last=bars[bars.length-1],sec=this.context.intervalSec||3600;
      if(t>last.time){
        const lastIndex=scale.timeToIndex(last.time,true);
        if(lastIndex==null)return width;
        const x=scale.logicalToCoordinate(Number(lastIndex)+(t-last.time)/sec);
        return x==null?width:Number(x);
      }
      if(t<first.time){
        this._lastClamp=true;
        const firstIndex=scale.timeToIndex(first.time,true);
        const x=firstIndex==null?0:scale.logicalToCoordinate(firstIndex);
        return x==null?0:Math.max(0,Number(x));
      }
      return null;
    }
    y(price){if(!this.series)return null;const y=this.series.priceToCoordinate(Number(price));return y==null?null:Number(y);}
    visibleByTime(from,to,start,end){
      const lo=from==null?-Infinity:Number(from),hi=to==null?Infinity:Number(to);
      return hi>=Number(start)&&lo<=Number(end);
    }
    autoscaleRange(start,end,values,from,to){
      if(!this.context.autoscale||!this.visibleByTime(from,to,start,end))return null;
      const nums=(values||[]).map(Number).filter(Number.isFinite);
      if(!nums.length)return null;
      return {priceRange:{minValue:Math.min(...nums),maxValue:Math.max(...nums)}};
    }
    lineStyle(ctx,style){if(style==='dotted')ctx.setLineDash([2,4]);else if(style==='dashed')ctx.setLineDash([7,5]);else ctx.setLineDash([]);}
    label(ctx,text,x,y,color,align){
      if(!text)return;ctx.save();ctx.font='11px -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif';
      ctx.textBaseline='bottom';ctx.textAlign=align||'left';ctx.fillStyle=color||'#e6e6e6';ctx.shadowColor='rgba(27,33,48,.9)';ctx.shadowBlur=3;ctx.fillText(String(text),x,y);ctx.restore();
    }
    approxLabel(label){return this.item.source==='approx'&&label&&!String(label).endsWith('≈')?String(label)+' ≈':label;}
    debugCoordinates(){
      const i=this.item;const time=i.time!=null?i.time:(i.from!=null?i.from:(Array.isArray(i.points)&&i.points[0]?i.points[0][0]:null));
      const price=i.price!=null?i.price:(i.high!=null?i.high:(i.top!=null?i.top:(i.poc!=null?i.poc:(Array.isArray(i.points)&&i.points[0]?i.points[0][1]:null))));
      const x=time==null?null:this.x(time,0),clamped=this._lastClamp,y=price==null?null:this.y(price);
      return {id:i.id,type:i.type,x,y,clamped};
    }
  }
  global.OrderFlowPrimitiveBase={AnnotationPrimitiveBase};
})(typeof globalThis!=='undefined'?globalThis:window);