(function(g){'use strict';
const S=g.OrderFlowAnnotationSchema;
const MAP={level:g.OrderFlowLevelPrimitive,zone:g.OrderFlowZonePrimitive,profile:g.OrderFlowProfilePrimitive,band:g.OrderFlowBandPrimitive,marker:g.OrderFlowMarkerPrimitive,callout:g.OrderFlowCalloutPrimitive,range:g.OrderFlowRangePrimitive,vline:g.OrderFlowVLinePrimitive,text:g.OrderFlowTextPrimitive};
class Renderer{
 constructor(series){this.series=series;this.attached=[];this.document=null;}
 clear(){for(const p of this.attached)this.series.detachPrimitive(p);this.attached=[];this.document=null;}
 render(doc){this.clear();const v=S.validateDocument(doc);if(!v.ok){console.warn('[annotations-v1] document rejected: '+v.errors.join('; '));return {ok:false,errors:v.errors,count:0};}
 for(const item of v.items){const C=MAP[item.type];if(!C){console.warn('[annotations-v1] missing primitive '+item.type);continue;}const p=new C(item);this.series.attachPrimitive(p);this.attached.push(p);}
 this.document={...doc,items:v.items};return {ok:true,errors:[],count:this.attached.length};}
}
g.OrderFlowAnnotationRenderer={Renderer};
})(globalThis);
