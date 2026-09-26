(function(global){
  'use strict';
  const Base=global.OrderFlowPrimitiveBase.AnnotationPrimitiveBase;
  class BandPrimitive extends Base{
    zOrder(){return 'bottom';}
    coords(){
      const pts=[];
      for(const p of this.item.points||[]){
        const x=this.x(p[0],0),mid=this.y(p[1]),upper=this.y(p[2]),lower=this.y(p[3]);
        if(x!=null&&mid!=null&&upper!=null&&lower!=null)pts.push({x,mid,upper,lower});
      }
      return pts;
    }
    draw(ctx,size){
      const pts=this.coords();if(!pts.length)return;
      const color=this.item.color||'#5cb85c';
      ctx.save();
      if(pts.length>1){
        ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].upper);
        for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x,pts[i].upper);
        for(let i=pts.length-1;i>=0;i--)ctx.lineTo(pts[i].x,pts[i].lower);
        ctx.closePath();ctx.fillStyle=this.item.fill||'rgba(190,196,208,0.10)';ctx.fill();
      }
      ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.setLineDash([]);
      ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].mid);for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x,pts[i].mid);ctx.stroke();
      ctx.strokeStyle='rgba(190,196,208,0.50)';ctx.lineWidth=1;
      for(const key of ['upper','lower']){
        ctx.beginPath();ctx.moveTo(pts[0].x,pts[0][key]);for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x,pts[i][key]);ctx.stroke();
      }
      this.label(ctx,this.approxLabel(this.item.label),pts[pts.length-1].x-5,pts[pts.length-1].mid-3,color,'right');
      ctx.restore();
    }
  }
  global.OrderFlowAnnotationPrimitives=global.OrderFlowAnnotationPrimitives||{};
  global.OrderFlowAnnotationPrimitives.band=BandPrimitive;
})(typeof globalThis!=='undefined'?globalThis:window);
