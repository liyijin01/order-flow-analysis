(function(global){
  'use strict';
  function jstParts(ms){
    const parts=new Intl.DateTimeFormat('en-GB',{
      timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
    }).formatToParts(new Date(Number(ms)));
    const out={};
    for(const part of parts)if(part.type!=='literal')out[part.type]=part.value;
    return out;
  }
  function formatJstClock(ms){
    const p=jstParts(ms);return p.hour+':'+p.minute+':'+p.second;
  }
  function formatCutoffJst(iso){
    const ms=Date.parse(String(iso||''));if(!Number.isFinite(ms))return'—';
    const p=jstParts(ms);return p.year+'/'+p.month+'/'+p.day+' '+p.hour+':'+p.minute;
  }
  function formatRemaining(ms){
    const sec=Math.max(0,Math.floor(ms/1000));
    const d=Math.floor(sec/86400),h=Math.floor((sec%86400)/3600);
    const m=Math.floor((sec%3600)/60),s=sec%60;
    const hText=String(h).padStart(2,'0');
    const mText=String(m).padStart(2,'0'),sText=String(s).padStart(2,'0');
    if(d>0)return d+'天 '+hText+':'+mText+':'+sText;
    return h>0?hText+':'+mText+':'+sText:mText+':'+sText;
  }
  function legendEntries(rules){
    const c=rules&&rules.colors||{};
    return[
      {key:'pq',label:'PQ 上季价值区',kind:'box',color:c.pqBorder},
      {key:'pm',label:'PM 上月价值区',kind:'box',color:c.pmBorder},
      {key:'pw',label:'PW 上周价值区',kind:'box',color:c.pwBorder},
      {key:'supply',label:'供应区',kind:'box',color:c.supplyBorder},
      {key:'demand',label:'需求区',kind:'box',color:c.demandBorder},
      {key:'current-vwap',label:'本季 VWAP ±1σ',kind:'line',color:c.vwap},
      {key:'pq-vwap',label:'PQ VWAP',kind:'line',color:c.pqVwap},
      {key:'npoc',label:'未回补 POC',kind:'dash',color:c.nPoc},
      {key:'key-level',label:'关键价位',kind:'dash',color:c.keyLevel}
    ];
  }
  function renderLegend(root,rules){
    if(!root)return;
    root.textContent='';
    for(const e of legendEntries(rules)){
      const item=document.createElement('span');
      item.className='legend-item';item.dataset.legend=e.key;
      const mark=document.createElement('i');
      mark.className='legend-mark '+(e.kind==='box'?'legend-box':(e.kind==='dash'?'legend-dash':'legend-line'));
      if(e.kind==='box')mark.style.backgroundColor=e.color;
      else mark.style.color=e.color;
      item.appendChild(mark);item.appendChild(document.createTextNode(e.label));root.appendChild(item);
    }
  }
  global.OrderFlowAnalysisUi={formatJstClock,formatCutoffJst,formatRemaining,legendEntries,renderLegend};
})(typeof globalThis!=='undefined'?globalThis:window);
