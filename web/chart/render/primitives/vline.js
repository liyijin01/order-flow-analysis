(function(global){
  'use strict';
  const Base=global.OrderFlowPrimitiveBase.AnnotationPrimitiveBase;
  class VLinePrimitive extends Base{
    draw(ctx,size){
      const i=this.item,x=this.x(i.time,size.width);if(x==null)return;
      const color=i.color||'rgba(244,246,251,.65)';
      ctx.save();ctx.strokeStyle=color;ctx.lineWidth=i.width||1;this.lineStyle(ctx,i.style||'dashed');
      ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,size.height);ctx.stroke();
      ctx.translate(x+4,14);ctx.rotate(Math.PI/2);this.label(ctx,i.label,0,0,color,'left');ctx.restore();
    }
  }
  global.OrderFlowAnnotationPrimitives=global.OrderFlowAnnotationPrimitives||{};
  global.OrderFlowAnnotationPrimitives.vline=VLinePrimitive;
})(typeof globalThis!=='undefined'?globalThis:window);
