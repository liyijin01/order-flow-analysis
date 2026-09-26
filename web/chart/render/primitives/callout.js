(function(global){
  'use strict';
  const Base=global.OrderFlowPrimitiveBase.AnnotationPrimitiveBase;
  class CalloutPrimitive extends Base{
    draw(ctx,size){
      const i=this.item,x=this.x(i.time,size.width),y=this.y(i.price);if(x==null||y==null)return;
      const text=String(i.text||''),color=i.color||'#f4f6fb';
      ctx.save();ctx.font='11px -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif';
      const w=Math.max(48,ctx.measureText(text).width+12),h=22,left=x+10,top=y-h-12;
      ctx.strokeStyle=color;ctx.fillStyle='rgba(27,33,48,.92)';ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(left,top+h);ctx.stroke();
      ctx.fillRect(left,top,w,h);ctx.strokeRect(left+.5,top+.5,w-1,h-1);
      ctx.fillStyle=color;ctx.textBaseline='middle';ctx.fillText(text,left+6,top+h/2);ctx.restore();
    }
  }
  global.OrderFlowAnnotationPrimitives=global.OrderFlowAnnotationPrimitives||{};
  global.OrderFlowAnnotationPrimitives.callout=CalloutPrimitive;
})(typeof globalThis!=='undefined'?globalThis:window);
