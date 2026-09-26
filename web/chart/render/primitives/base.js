(function(global){
'use strict';
class BasePrimitive{
 constructor(item){this.item=item;this.chart=null;this.series=null;this.requestUpdate=null;this._view={renderer:()=>({draw:(target)=>target.useMediaCoordinateSpace(({context,mediaSize})=>this.draw(context,mediaSize))}),zOrder:()=> 'top'};}
 attached(p){this.chart=p.chart;this.series=p.series;this.requestUpdate=p.requestUpdate;}
 detached(){this.chart=null;this.series=null;this.requestUpdate=null;}
 paneViews(){return [this._view];}
 updateAllViews(){}
 x(t){return this.chart?this.chart.timeScale().timeToCoordinate(t):null;}
 y(p){return this.series?this.series.priceToCoordinate(p):null;}
 right(size){return this.item.to==null?size.width:this.x(this.item.to);}
 color(def){return this.item.color||def||'#f4f6fb';}
 label(){const s=this.item.source==='approx'?' ≈':'';return (this.item.label||'')+s;}
 line(ctx,x1,y1,x2,y2,color,width,dash){if([x1,y1,x2,y2].some(v=>v==null||!Number.isFinite(v)))return;ctx.save();ctx.strokeStyle=color;ctx.lineWidth=width||1;ctx.setLineDash(dash||[]);ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();ctx.restore();}
 text(ctx,text,x,y,color,bg){if(!text||x==null||y==null)return;ctx.save();ctx.font='12px -apple-system,BlinkMacSystemFont,Segoe UI,Arial';const w=ctx.measureText(text).width+8;if(bg){ctx.fillStyle=bg;ctx.fillRect(x,y-14,w,18);}ctx.fillStyle=color||'#fff';ctx.fillText(text,x+4,y);ctx.restore();}
}
global.OrderFlowPrimitiveBase={BasePrimitive};
})(typeof globalThis!=='undefined'?globalThis:window);
