(function(){
'use strict';
const names={quarter:'季度价值',rvwap:'滚动 VWAP',weekly:'周度 VWAP',monthly:'月线结构',mprofile:'月度剖面',wprofile:'周度剖面',ssd:'稳定币占比'};
const valid=new Set(['BTCUSDT','ETHUSDT','SOLUSDT']);
const $=id=>document.getElementById(id);
const number=v=>Number(v).toLocaleString('en-US',{maximumFractionDigits:3});
const percent=v=>v===null||v===undefined||!Number.isFinite(Number(v))?'—':Number(v).toFixed(2)+'%';
const stateName={above:'上方',below:'下方',inside:'区间内'};
function link(tpl,symbol){return 'analysis.html?tpl='+encodeURIComponent(tpl)+'&symbol='+encodeURIComponent(symbol);}
function el(tag,text,cls){const e=document.createElement(tag);if(text!=null)e.textContent=String(text);if(cls)e.className=cls;return e;}
function sourceLinks(row,symbol){
  const target=el('span',null,'sources');
  for(const source of row.levels){
    const a=el('a',source.name);a.href=link(source.template,symbol);
    target.append(a);
  }
  return target;
}
function zoneRow(row,symbol,current){
  const section=el('div',null,'row '+row.strength);
  const range=row.low===row.high?number(row.low):number(row.low)+' ~ '+number(row.high);
  const dist=current>row.high?(row.high-current)/current*100:current<row.low?(row.low-current)/current*100:0;
  section.append(el('span',range+' · '+row.sources+' 来源','price'));
  section.append(el('span',(dist>0?'+':'')+percent(dist),'dist'));
  section.append(sourceLinks(row,symbol));
  return section;
}
function nearest(zones,current,above){
  return zones.filter(z=>above?z.low>current:z.high<current)
    .sort((a,b)=>above?a.low-b.low:b.high-a.high)[0]||null;
}
function zoneText(z){return z?number(z.low)+'~'+number(z.high)+'（'+z.sources+' 个来源）':'暂无';}
function formatRef(v){return v&&typeof v==='object'?number(v.low)+' ~ '+number(v.high):v===null||v===undefined?'—':number(v);}
function draw(data){
  const current=Number(data.currentPrice),zones=data.zones||[],symbol=data.symbol;
  document.querySelectorAll('button[data-symbol]').forEach(b=>b.classList.toggle('active',b.dataset.symbol===symbol));
  const ts=new Date(data.dataCutoffUtc),jst=Number.isFinite(ts.getTime())?ts.toLocaleString('zh-CN',{timeZone:'Asia/Tokyo',hour12:false}):'未知';
  $('headline').textContent=symbol+'.P 每日简报 · 数据截至 '+jst+' JST';
  const age=Date.now()-Date.parse(data.generatedAt);
  $('freshness').textContent=age>36*3600000?'数据已超过 36 小时，请核实更新状态':'生成于 '+new Date(data.generatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Tokyo'});
  $('freshness').classList.toggle('stale',age>36*3600000);
  const above=nearest(zones,current,true),below=nearest(zones,current,false);
  const ssd=(data.states||[]).find(x=>x.name==='稳定币占比 vs 9.064%');
  const dominance=ssd?number(ssd.value)+'%，在 9.064% '+(ssd.state==='above'?'之上':ssd.state==='below'?'之下':'附近'):'暂无';
  $('summary').textContent='现价 '+number(current)+'。上方最近的合流区 '+zoneText(above)+'，下方最近的合流区 '+zoneText(below)+'。稳定币占比 '+dominance+'。';
  const main=$('ladder'),singles=$('singleLadder');main.replaceChildren();singles.replaceChildren();
  const top=zones.filter(z=>z.low>current).sort((a,b)=>b.high-a.high);
  const bottom=zones.filter(z=>z.high<current).sort((a,b)=>b.high-a.high);
  const overlaps=zones.filter(z=>z.low<=current&&z.high>=current).sort((a,b)=>b.high-a.high);
  for(const z of top) (z.strength==='single'?singles:main).append(zoneRow(z,symbol,current));
  const center=el('div','现价 '+number(current),'row current');main.append(center);
  for(const z of overlaps.concat(bottom))(z.strength==='single'?singles:main).append(zoneRow(z,symbol,current));
  const tbody=$('states');tbody.replaceChildren();
  for(const s of data.states||[]){
    const tr=el('tr');const entries=[s.name,number(s.value),formatRef(s.reference),stateName[s.state]||s.state,percent(s.distancePct),names[s.template]||s.template];
    entries.forEach((value,i)=>{
      const td=el('td',i===5?'':value,i===3?s.state:'');td.dataset.label=['名称','当前值','参考值','状态','距离 %','模板'][i];
      if(i===5){const a=el('a',value);a.href=link(s.template,symbol);td.append(a);}
      tr.append(td);
    });tbody.append(tr);
  }
  const gallery=$('pngs');gallery.replaceChildren();
  for(const png of data.pngs||[]){
    const tpl=png==='SSD-1d.png'?'ssd':(png.match(/-(quarter|rvwap|weekly|monthly|mprofile|wprofile)-/)||[])[1];
    const article=el('article'),a=el('a');a.href='analysis/png/'+encodeURIComponent(png);a.target='_blank';a.rel='noopener noreferrer';
    const img=el('img');img.src=a.href;img.alt=png;img.loading='lazy';a.append(img);article.append(a);
    const p=el('p');p.append(el('span',names[tpl]||png));const live=el('a','实时页面 ↗');live.href=link(tpl,symbol);p.append(live);article.append(p);gallery.append(article);
  }
}
async function load(symbol){
  $('summary').textContent='读取简报…';
  const response=await fetch('analysis/brief/'+encodeURIComponent(symbol)+'.json',{cache:'no-store'});
  if(!response.ok)throw new Error('简报数据 HTTP '+response.status);
  const data=await response.json();
  if(data.symbol!==symbol)throw new Error('简报币种不匹配');
  draw(data);
}
function navigate(symbol){
  if(!valid.has(symbol))return;
  const url=new URL(location.href);url.searchParams.set('symbol',symbol);
  history.replaceState(null,'',url);
  void load(symbol).catch(e=>{$('summary').textContent='加载失败：'+e.message;});
}
document.querySelectorAll('button[data-symbol]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.symbol)));
const initial=new URLSearchParams(location.search).get('symbol');
navigate(valid.has(initial)?initial:'BTCUSDT');
})();
