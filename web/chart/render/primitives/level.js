(function(global){'use strict';
const Base=global.OrderFlowPrimitiveBase.AnnotationPrimitiveBase;
class LevelPrimitive extends Base{
  constructor(item){super(item);this._axisView={coordinate:()=>{const y=this.y(this.item.price);return y==null?-1000:y;},text:()=>Number(this.item.price).toLocaleString(undefined,{maximumFractionDigits:6}),textColor:()=> '#111111',backColor:()=> '#f4f6fb',visible:()=>this.item.axisLabel!==false,tickVisible:()=>true};}
  priceAxisViews(){return this.item.axisLabel===false?[]:[this._axisView];}
  autoscaleInfo(start,end){return this.autoscaleRange(start,end,[this.item.price],this.item.from,this.item.to);}
  draw(ctx,size){const i=this.item;let x1=this.x(i.from,size.width),x2=this.x(i.to,size.width),y=this.y(i.price);if(y==null)return;if(x1==null)x1=0;if(x2==null)x2=size.width;
    ctx.save();ctx.strokeStyle=i.color||'#e6e6e6';ctx.lineWidth=i.width||1;this.lineStyle(ctx,i.style||'dashed');ctx.beginPath();ctx.moveTo(x1,y);ctx.lineTo(x2,y);ctx.stroke();
    const labelY=Number.isFinite(i._labelY)?i._labelY:y-3;this.label(ctx,this.approxLabel(i.label),Math.min(size.width-8,x2-5),labelY,i.color||'#e6e6e6','right');ctx.restore();}
}
global.OrderFlowAnnotationPrimitives=global.OrderFlowAnnotationPrimitives||{};global.OrderFlowAnnotationPrimitives.level=LevelPrimitive;})(typeof globalThis!=='undefined'?globalThis:window);