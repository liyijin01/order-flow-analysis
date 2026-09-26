(function(global){
  'use strict';
  const Base=global.OrderFlowPrimitiveBase.AnnotationPrimitiveBase;
  class TextPrimitive extends Base{
    draw(ctx,size){
      const i=this.item,x=this.x(i.time,size.width),y=this.y(i.price);if(x==null||y==null)return;
      this.label(ctx,i.text,x,y,i.color||'#f4f6fb',i.align||'left');
    }
  }
  global.OrderFlowAnnotationPrimitives=global.OrderFlowAnnotationPrimitives||{};
  global.OrderFlowAnnotationPrimitives.text=TextPrimitive;
})(typeof globalThis!=='undefined'?globalThis:window);
