(function(global){
  'use strict';
  const S=global.OrderFlowAnnotationSchema;

  class AnnotationRenderer{
    constructor(chart,series){
      this.chart=chart;this.series=series;this.entries=[];this.lastDocument=null;this.stats={rendered:0,skipped:0,errors:[]};
    }
    clear(){
      for(const entry of this.entries){
        try{this.series.detachPrimitive(entry.primitive);}catch(error){console.warn('annotation detach failed',entry.item&&entry.item.id,error);}
      }
      this.entries=[];this.lastDocument=null;this.stats={rendered:0,skipped:0,errors:[]};
    }
    render(doc){
      this.clear();
      const result=S.validateDocument(doc);
      if(!result.valid){
        console.warn('annotations-v1 document rejected:',result.errors.join('; '));
        this.stats={rendered:0,skipped:(doc&&Array.isArray(doc.items)?doc.items.length:0),errors:result.errors.slice()};
        return this.stats;
      }
      for(const issue of result.itemErrors){
        console.warn('annotation skipped',issue.id||('#'+issue.index),issue.errors.join('; '));
      }
      for(const item of result.items){
        const Primitive=global.OrderFlowAnnotationPrimitives&&global.OrderFlowAnnotationPrimitives[item.type];
        if(!Primitive){
          console.warn('annotation skipped',item.id,'primitive missing for type',item.type);
          continue;
        }
        try{
          const primitive=new Primitive(item);
          this.series.attachPrimitive(primitive);
          this.entries.push({item,primitive});
        }catch(error){
          console.warn('annotation skipped',item.id,error);
        }
      }
      this.lastDocument=doc;
      this.stats={
        rendered:this.entries.length,
        skipped:(doc.items.length-this.entries.length),
        errors:result.itemErrors.slice()
      };
      return this.stats;
    }
    debugCoordinates(){
      return this.entries.map(({item,primitive})=>primitive.debugCoordinates?primitive.debugCoordinates():{id:item.id,type:item.type});
    }
  }

  async function loadAnnotationFixture(id){
    const response=await fetch('web/chart/fixtures/'+id+'.json',{cache:'no-store'});
    if(!response.ok)throw new Error('fixture '+id+' HTTP '+response.status);
    return response.json();
  }

  global.OrderFlowAnnotationRenderer={AnnotationRenderer,loadAnnotationFixture};
})(typeof globalThis!=='undefined'?globalThis:window);
