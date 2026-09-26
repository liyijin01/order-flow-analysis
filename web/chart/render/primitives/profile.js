(function(global){
  'use strict';
  const Base=global.OrderFlowPrimitiveBase.AnnotationPrimitiveBase;
  class ProfilePrimitive extends Base{
    zOrder(){return 'bottom';}
    drawReference(ctx,size,price,color,width,style,label){
      if(price==null)return;const y=this.y(price);if(y==null)return;
      let x1=this.x(this.item.from,size.width),x2=this.x(this.item.to,size.width);
      if(x1==null)x1=0;if(x2==null)x2=size.width;
      ctx.save();ctx.strokeStyle=color;ctx.lineWidth=width||1;this.lineStyle(ctx,style||'solid');
      ctx.beginPath();ctx.moveTo(x1,y);ctx.lineTo(x2,y);ctx.stroke();
      if(label)this.label(ctx,label,x1+3,y-2,color,'left');ctx.restore();
    }
    draw(ctx,size){
      const i=this.item;let x1=this.x(i.from,size.width),x2=this.x(i.to,size.width);
      if(x1==null||x2==null||!Array.isArray(i.rows)||!i.rows.length)return;
      const max=Math.max(...i.rows.map(r=>Number(r[1])||0),1);
      const width=Math.max(8,Math.abs(x2-x1));const dir=x2>=x1?1:-1;
      ctx.save();ctx.fillStyle=i.fill||'rgba(185,193,205,0.24)';
      for(const row of i.rows){
        const p=Number(row[0]),count=Number(row[1])||0;
        const y1=this.y(p+i.binSize/2),y2=this.y(p-i.binSize/2);
        if(y1==null||y2==null)continue;
        const h=Math.max(1,Math.abs(y2-y1));const w=width*(count/max);
        const left=dir>0?x1:x1-w;ctx.fillRect(left,Math.min(y1,y2),w,h);
      }
      ctx.restore();
      this.drawReference(ctx,size,i.poc,'#ff7043',2,'solid','POC ▸');
      this.drawReference(ctx,size,i.vah,'#4fc3f7',1,'dotted','VAH ▸');
      this.drawReference(ctx,size,i.val,'#4fc3f7',1,'dotted','VAL ▸');
    }
  }
  global.OrderFlowAnnotationPrimitives=global.OrderFlowAnnotationPrimitives||{};
  global.OrderFlowAnnotationPrimitives.profile=ProfilePrimitive;
})(typeof globalThis!=='undefined'?globalThis:window);
