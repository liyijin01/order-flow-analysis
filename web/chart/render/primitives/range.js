(function(global){
  'use strict';
  const Base=global.OrderFlowPrimitiveBase.AnnotationPrimitiveBase;
  class RangePrimitive extends Base{
    zOrder(){return 'bottom';}
    draw(ctx,size){
      const i=this.item;let x1=this.x(i.from,size.width),x2=this.x(i.to,size.width);
      const yh=this.y(i.high),yl=this.y(i.low);if(x1==null||x2==null||yh==null||yl==null)return;
      const left=Math.min(x1,x2),right=Math.max(x1,x2),top=Math.min(yh,yl),bottom=Math.max(yh,yl);
      const border=i.border||'#f4f6fb';
      ctx.save();ctx.fillStyle=i.fill||'rgba(255,255,255,.045)';ctx.strokeStyle=border;ctx.lineWidth=i.width||1;
      ctx.fillRect(left,top,right-left,bottom-top);ctx.strokeRect(left+.5,top+.5,Math.max(0,right-left-1),Math.max(0,bottom-top-1));
      const labels=Array.isArray(i.labels)?i.labels:[];
      if(labels[0])this.label(ctx,labels[0],right-5,top+13,border,'right');
      if(labels[1])this.label(ctx,labels[1],right-5,bottom-3,border,'right');
      ctx.restore();
    }
  }
  global.OrderFlowAnnotationPrimitives=global.OrderFlowAnnotationPrimitives||{};
  global.OrderFlowAnnotationPrimitives.range=RangePrimitive;
})(typeof globalThis!=='undefined'?globalThis:window);
