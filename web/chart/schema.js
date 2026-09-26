(function (global) {
  'use strict';

  const TYPES = ['level','zone','profile','band','marker','callout','range','vline','text'];

  const ANNOTATIONS_SCHEMA = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'annotations-v1',
    type: 'object',
    required: ['schema','symbol','market','interval','generatedAt','items'],
    properties: {
      schema: { const: 'annotations-v1' },
      symbol: { type: 'string', minLength: 1 },
      market: { enum: ['um','spot'] },
      interval: { type: 'string', minLength: 1 },
      generatedAt: { type: 'string', minLength: 1 },
      items: { type: 'array' }
    }
  };

  function isNum(v){return typeof v==='number' && Number.isFinite(v);}
  function isUtcSecond(v){return Number.isInteger(v) && v>0 && v<10000000000;}
  function isNullableTime(v){return v===null || isUtcSecond(v);}
  function isStr(v){return typeof v==='string' && v.length>0;}
  function isColor(v){return v==null || typeof v==='string';}
  function validSource(v){return v==null || ['exact','approx','manual'].includes(v);}

  function validateItem(item) {
    const errors=[];
    if(!item || typeof item!=='object' || Array.isArray(item)) return {valid:false,errors:['item must be object']};
    if(!isStr(item.id)) errors.push('id must be non-empty string');
    if(!TYPES.includes(item.type)) errors.push('unsupported type: '+item.type);
    if(!validSource(item.source)) errors.push('source must be exact|approx|manual');

    const req=(name,check,msg)=>{if(!check(item[name]))errors.push(name+' '+msg);};
    switch(item.type){
      case 'level':
        req('price',isNum,'must be finite number');
        req('label',isStr,'must be non-empty string');
        req('from',isUtcSecond,'must be UTC seconds');
        if(!isNullableTime(item.to))errors.push('to must be UTC seconds or null');
        if(item.axisLabel!=null && typeof item.axisLabel!=='boolean')errors.push('axisLabel must be boolean');
        if(!isColor(item.color))errors.push('color must be string');
        break;
      case 'zone':
        req('top',isNum,'must be finite number');
        req('bottom',isNum,'must be finite number');
        req('from',isUtcSecond,'must be UTC seconds');
        if(!isNullableTime(item.to))errors.push('to must be UTC seconds or null');
        if(item.top<=item.bottom)errors.push('top must be greater than bottom');
        if(!isColor(item.border)||!isColor(item.fill))errors.push('border/fill must be strings');
        break;
      case 'profile':
        req('from',isUtcSecond,'must be UTC seconds');
        req('to',isUtcSecond,'must be UTC seconds');
        req('binSize',isNum,'must be finite number');
        if(!Array.isArray(item.rows)||!item.rows.length||item.rows.some(r=>!Array.isArray(r)||r.length<2||!isNum(r[0])||!isNum(r[1])))errors.push('rows must be [price,count][]');
        ['poc','vah','val'].forEach(k=>{if(item[k]!=null&&!isNum(item[k]))errors.push(k+' must be number');});
        break;
      case 'band':
        if(!Array.isArray(item.points)||!item.points.length||item.points.some(p=>!Array.isArray(p)||p.length<4||!isUtcSecond(p[0])||p.slice(1).some(v=>!isNum(v))))errors.push('points must be [time,mid,upper,lower,...][]');
        if(!isColor(item.color))errors.push('color must be string');
        break;
      case 'marker':
        req('time',isUtcSecond,'must be UTC seconds');
        req('price',isNum,'must be finite number');
        if(item.shape!=null && !['circle','cross','arrowUp','arrowDown'].includes(item.shape))errors.push('invalid marker shape');
        break;
      case 'callout':
        req('time',isUtcSecond,'must be UTC seconds');
        req('price',isNum,'must be finite number');
        req('text',isStr,'must be non-empty string');
        break;
      case 'range':
        req('from',isUtcSecond,'must be UTC seconds');
        req('to',isUtcSecond,'must be UTC seconds');
        req('high',isNum,'must be finite number');
        req('low',isNum,'must be finite number');
        if(item.high<=item.low)errors.push('high must be greater than low');
        if(item.labels!=null && (!Array.isArray(item.labels)||item.labels.some(x=>typeof x!=='string')))errors.push('labels must be string[]');
        break;
      case 'vline':
        req('time',isUtcSecond,'must be UTC seconds');
        break;
      case 'text':
        req('time',isUtcSecond,'must be UTC seconds');
        req('price',isNum,'must be finite number');
        req('text',isStr,'must be non-empty string');
        break;
    }
    return {valid:errors.length===0,errors};
  }

  function validateDocument(doc) {
    const errors=[];
    if(!doc||typeof doc!=='object'||Array.isArray(doc))return {valid:false,errors:['document must be object'],items:[]};
    if(doc.schema!=='annotations-v1')errors.push('schema must equal annotations-v1');
    if(!isStr(doc.symbol))errors.push('symbol must be non-empty string');
    if(!['um','spot'].includes(doc.market))errors.push('market must be um or spot');
    if(!isStr(doc.interval))errors.push('interval must be non-empty string');
    if(!isStr(doc.generatedAt))errors.push('generatedAt must be non-empty string');
    if(!Array.isArray(doc.items))errors.push('items must be array');

    const validItems=[];
    const itemErrors=[];
    (Array.isArray(doc.items)?doc.items:[]).forEach((item,index)=>{
      const result=validateItem(item);
      if(result.valid) validItems.push(item);
      else itemErrors.push({index,id:item&&item.id,type:item&&item.type,errors:result.errors});
    });
    return {valid:errors.length===0,errors,items:validItems,itemErrors};
  }

  global.OrderFlowAnnotationSchema={ANNOTATIONS_SCHEMA,TYPES,validateItem,validateDocument};
})(typeof globalThis!=='undefined'?globalThis:window);
