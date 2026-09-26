(function(global){
  'use strict';
  const Base=global.OrderFlowPrimitiveBase.AnnotationPrimitiveBase;
  class ZonePrimitive extends Base{
    zOrder(){return 'bottom';}
    draw(ctx,size){
      const i=this.item;let x1=this.x(i.from,size.width),x2=this.x(i.to,size.width);
      const yt=this.y(i.top),yb=this.y(i.bottom);
      if(yt==null||yb==null)return;if(x1==null)x1=0;if(x2==null)x2=size.width;
      const left=Math.min(x1,x2),right=Math.max(x1,x2),top=Math.min(yt,yb),bottom=Math.max(yt,yb);
      ctx.save();ctx.fillStyle=i.fill||'rgba(79,195,247,0.10)';ctx.strokeStyle=i.border||'#ffffff';ctx.lineWidth=i.width||1;
      ctx.fillRect(left,top,right-left,bottom-top);ctx.strokeRect(left+.5,top+.5,Math.max(0,right-left-1),Math.max(0,bottom-top-1));
      this.label(ctx,this.approxLabel(i.label),right-7,bottom-5,i.border||'#ffffff','right');ctx.restore();
    }
  }
  global.OrderFlowAnnotationPrimitives=global.OrderFlowAnnotationPrimitives||{};
  global.OrderFlowAnnotationPrimitives.zone=ZonePrimitive;
})(typeof globalThis!=='undefined'?globalThis:window);
