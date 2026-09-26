(function(global){
  'use strict';

  class AnnotationPrimitiveBase {
    constructor(item){
      this.item=item;
      this.chart=null;
      this.series=null;
      this.requestUpdate=null;
      this._view={
        zOrder:()=>this.zOrder(),
        renderer:()=>({
          draw:(target)=>target.useMediaCoordinateSpace((scope)=>this.draw(scope.context,scope.mediaSize))
        })
      };
    }
    attached(params){
      this.chart=params.chart;
      this.series=params.series;
      this.requestUpdate=params.requestUpdate;
    }
    detached(){
      this.chart=null;
      this.series=null;
      this.requestUpdate=null;
    }
    paneViews(){return [this._view];}
    updateAllViews(){}
    zOrder(){return 'top';}
    x(time,width){
      if(time==null)return width;
      if(!this.chart)return null;
      const x=this.chart.timeScale().timeToCoordinate(time);
      return x==null?null:Number(x);
    }
    y(price){
      if(!this.series)return null;
      const y=this.series.priceToCoordinate(Number(price));
      return y==null?null:Number(y);
    }
    lineStyle(ctx,style){
      if(style==='dotted')ctx.setLineDash([2,4]);
      else if(style==='dashed')ctx.setLineDash([7,5]);
      else ctx.setLineDash([]);
    }
    label(ctx,text,x,y,color,align){
      if(!text)return;
      ctx.save();
      ctx.font='11px -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif';
      ctx.textBaseline='bottom';
      ctx.textAlign=align||'left';
      ctx.fillStyle=color||'#e6e6e6';
      ctx.shadowColor='rgba(27,33,48,.9)';
      ctx.shadowBlur=3;
      ctx.fillText(String(text),x,y);
      ctx.restore();
    }
    approxLabel(label){
      return this.item.source==='approx' && label && !String(label).endsWith('≈') ? String(label)+' ≈' : label;
    }
    debugCoordinates(){
      const i=this.item;
      const time=i.time!=null?i.time:(i.from!=null?i.from:(Array.isArray(i.points)&&i.points[0]?i.points[0][0]:null));
      const price=i.price!=null?i.price:(i.high!=null?i.high:(i.top!=null?i.top:(i.poc!=null?i.poc:(Array.isArray(i.points)&&i.points[0]?i.points[0][1]:null))));
      return {id:i.id,type:i.type,x:time==null?null:this.x(time,0),y:price==null?null:this.y(price)};
    }
  }

  global.OrderFlowPrimitiveBase={AnnotationPrimitiveBase};
})(typeof globalThis!=='undefined'?globalThis:window);
