(function(global){'use strict';const S=global.OrderFlowAnnotationSchema;
class AnnotationRenderer{
constructor(chart,series){this.chart=chart;this.series=series;this.entries=[];this.lastDocument=null;this.context={bars:[],intervalSec:3600,autoscale:true,timeOffsetSec:0,priceFormatter:null};this.stats={rendered:0,skipped:0,errors:[]};}
setContext(context){this.context={...this.context,...(context||{})};for(const e of this.entries)e.primitive.setContext&&e.primitive.setContext(this.context);this.relayoutLabels();}
clear(){for(const e of this.entries){try{this.series.detachPrimitive(e.primitive);}catch(error){console.warn('annotation detach failed',e.item&&e.item.id,error);}}this.entries=[];this.lastDocument=null;this.stats={rendered:0,skipped:0,errors:[]};}
relayoutLabels(){
  const levels=this.entries.filter(e=>e.item.type==='level'&&e.item.showLabel!==false).map(e=>({e,y:this.series.priceToCoordinate(Number(e.item.price))})).filter(x=>x.y!=null).sort((a,b)=>a.y-b.y);
  let prev=-Infinity;
  for(const x of levels){
    let y=Number(x.y);
    if(y-prev<12)y=prev+12;
    x.e.item._labelY=y;x.e.item._axisY=y;prev=y;
  }
  for(const e of this.entries)e.primitive.requestUpdate&&e.primitive.requestUpdate();
}
render(doc){
  this.clear();const result=S.validateDocument(doc);
  if(!result.valid){console.warn('annotations-v1 document rejected:',result.errors.join('; '));this.stats={rendered:0,skipped:(doc&&Array.isArray(doc.items)?doc.items.length:0),errors:result.errors.slice()};return this.stats;}
  for(const issue of result.itemErrors)console.warn('annotation skipped',issue.id||('#'+issue.index),issue.errors.join('; '));
  for(const item of result.items){
    const Primitive=global.OrderFlowAnnotationPrimitives&&global.OrderFlowAnnotationPrimitives[item.type];
    if(!Primitive){console.warn('annotation skipped',item.id,'primitive missing for type',item.type);continue;}
    try{const primitive=new Primitive(item);primitive.setContext&&primitive.setContext(this.context);this.series.attachPrimitive(primitive);this.entries.push({item,primitive});}
    catch(error){console.warn('annotation skipped',item.id,error);}
  }
  this.lastDocument=doc;this.stats={rendered:this.entries.length,skipped:doc.items.length-this.entries.length,errors:result.itemErrors.slice()};this.relayoutLabels();return this.stats;
}
hoverText(objectId){
  if(objectId==null)return '';
  const id=String(objectId).replace(/^annotation:/,'');
  const hit=this.entries.find(e=>String(e.item.id)===id);
  return hit&&hit.item.hoverText?String(hit.item.hoverText):'';
}
debugCoordinates(){return this.entries.map(({item,primitive})=>primitive.debugCoordinates?primitive.debugCoordinates():{id:item.id,type:item.type});}
debugProfiles(){return this.entries.filter(e=>e.item.type==='profile').map(e=>e.primitive.debugProfile());}}
async function loadAnnotationFixture(id){const response=await fetch('web/chart/fixtures/'+id+'.json',{cache:'no-store'});if(!response.ok)throw new Error('fixture '+id+' HTTP '+response.status);return response.json();}
global.OrderFlowAnnotationRenderer={AnnotationRenderer,loadAnnotationFixture};})(typeof globalThis!=='undefined'?globalThis:window);
