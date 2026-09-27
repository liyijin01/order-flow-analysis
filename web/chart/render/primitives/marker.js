(function(global){'use strict';const Base=global.OrderFlowPrimitiveBase.AnnotationPrimitiveBase;
class MarkerPrimitive extends Base{
autoscaleInfo(start,end){return this.autoscaleRange(start,end,[this.item.price],this.item.time,this.item.time);}
hitTest(x,y){
  const px=this.x(this.item.time,0),py=this.y(this.item.price);if(px==null||py==null)return null;
  const d=Math.hypot(Number(x)-px,Number(y)-py);
  return d<=8?{externalId:'annotation:'+this.item.id,zOrder:'top',cursorStyle:'pointer'}:null;
}
draw(ctx,size){
  const i=this.item,x=this.x(i.time,size.width),y=this.y(i.price);if(x==null||y==null)return;
  const color=i.color||'#f4f6fb',shape=i.shape||'circle';ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=1.4;ctx.setLineDash([]);
  if(shape==='circle'){ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.stroke();}
  else if(shape==='cross'){ctx.beginPath();ctx.moveTo(x-5,y-5);ctx.lineTo(x+5,y+5);ctx.moveTo(x+5,y-5);ctx.lineTo(x-5,y+5);ctx.stroke();}
  else{const dir=shape==='arrowDown'?1:-1;ctx.beginPath();ctx.moveTo(x,y+dir*7);ctx.lineTo(x-5,y-dir);ctx.lineTo(x+5,y-dir);ctx.closePath();ctx.fill();}
  if(i.text)this.label(ctx,i.text,x+8,y-7,color,'left');ctx.restore();
}}
global.OrderFlowAnnotationPrimitives=global.OrderFlowAnnotationPrimitives||{};global.OrderFlowAnnotationPrimitives.marker=MarkerPrimitive;})(typeof globalThis!=='undefined'?globalThis:window);
