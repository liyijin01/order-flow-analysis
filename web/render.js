(function (global) {
  'use strict';
  const C = global.OrderFlowCore;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  }

  function lineCvdSvg(buckets, title, formatTime) {
    if (!buckets.length) return '<div class="notice">No data.</div>';
    const W=1200,H=300,L=70,R=1180,T=42,B=245;
    const xs=[]; const ys=[];
    for (const b of buckets) { xs.push(b.t); ys.push(b.low); ys.push(b.high); }
    const xr=C.minMax(xs), yr=C.minMax(ys);
    const xmin=xr.min, xmax=xr.max;
    let ymin=Math.min(0,yr.min), ymax=Math.max(0,yr.max);
    if (ymax===ymin) ymax=ymin+1;
    const x=(v)=>L+(v-xmin)/(xmax-xmin||1)*(R-L);
    const y=(v)=>B-(v-ymin)/(ymax-ymin)*(B-T);
    let path='';
    let wicks='';
    for (let i=0;i<buckets.length;i+=1) {
      const b=buckets[i];
      const xx=x(b.t).toFixed(1);
      wicks += '<line x1="'+xx+'" y1="'+y(b.high).toFixed(1)+'" x2="'+xx+'" y2="'+y(b.low).toFixed(1)+'" stroke="#bbb" stroke-width="0.8"/>';
      if (i===0 || b.brokenBefore) path += 'M'+xx+' '+y(b.close).toFixed(1);
      else path += 'L'+xx+' '+y(b.close).toFixed(1);
    }
    return '<svg viewBox="0 0 '+W+' '+H+'"><text x="70" y="24" font-size="12" font-weight="600">'+escapeHtml(title)+'</text>'+wicks+'<line x1="70" y1="'+y(0)+'" x2="1180" y2="'+y(0)+'" stroke="#999"/><path d="'+path+'" fill="none" stroke="#111" stroke-width="1.4"/><text x="70" y="278" font-size="10">'+escapeHtml(formatTime(xmin))+' JST</text><text x="1060" y="278" font-size="10">'+escapeHtml(formatTime(xmax))+' JST</text></svg>';
  }

  function profileSvg(rows, rowSize, title, priceFromIndex) {
    if (!rows.length) return '<div class="notice">No data.</div>';
    const W=1200,H=Math.min(700,Math.max(260,rows.length*9+70)),L=100,R=1160,T=35,B=H-30;
    const totals=[];
    for (const r of rows) totals.push(r[1].buy+r[1].sell);
    const max=C.maxValue(totals) || 1;
    const rh=(B-T)/rows.length;
    let s='<svg viewBox="0 0 '+W+' '+H+'"><text x="100" y="22" font-size="12" font-weight="600">'+escapeHtml(title)+'</text>';
    rows.forEach((r,i)=>{
      const yy=B-(i+1)*rh,sw=(r[1].sell/max)*(R-L),bw=(r[1].buy/max)*(R-L);
      const price=priceFromIndex ? priceFromIndex(r[0]) : r[0]+rowSize/2;
      s+='<rect x="'+L+'" y="'+yy+'" width="'+sw+'" height="'+Math.max(1,rh-1)+'" fill="#f0caca"/><rect x="'+(L+sw)+'" y="'+yy+'" width="'+bw+'" height="'+Math.max(1,rh-1)+'" fill="#cce8d2"/><text x="6" y="'+(yy+rh*.72)+'" font-size="9">'+Number(price).toLocaleString(undefined,{maximumFractionDigits:4})+'</text>';
    });
    return s+'</svg>';
  }

  function footprintHtml(cols, row, latestPrice, formatTime) {
    let times=[...cols.keys()].sort((a,b)=>a-b);
    if (!times.length) return '<div class="notice">No footprint data.</div>';
    times=times.slice(-20);
    const priceSet=[];
    const seen=new Set();
    times.forEach((t)=>cols.get(t).forEach((v,k)=>{ if(!seen.has(k)){seen.add(k);priceSet.push(k);} }));
    const prices=C.clipFootprintPrices(priceSet,Math.floor(latestPrice/row)*row,80);
    let h='<table class="fp"><thead><tr><th>Price</th>';
    times.forEach((t)=>{h+='<th colspan="2">'+escapeHtml(formatTime(t).split(' ')[1]||formatTime(t))+'</th>';});
    h+='</tr><tr><th></th>';times.forEach(()=>{h+='<th>Bid</th><th>Ask</th>';});h+='</tr></thead><tbody>';
    prices.forEach((p)=>{
      h+='<tr><td class="price">'+(p+row/2).toLocaleString(undefined,{maximumFractionDigits:4})+'</td>';
      times.forEach((t)=>{const b=cols.get(t).get(p)||{buy:0,sell:0};h+='<td class="sell">'+b.sell.toFixed(3)+'</td><td class="buy">'+b.buy.toFixed(3)+'</td>';});
      h+='</tr>';
    });
    h+='<tr class="summary"><td>Delta</td>';
    times.forEach((t)=>{let buy=0,sell=0;cols.get(t).forEach((b)=>{buy+=b.buy;sell+=b.sell;});const d=buy-sell;h+='<td colspan="2">'+(d>=0?'+':'')+d.toFixed(3)+'</td>';});
    h+='</tr><tr class="summary"><td>Total</td>';
    times.forEach((t)=>{let buy=0,sell=0;cols.get(t).forEach((b)=>{buy+=b.buy;sell+=b.sell;});h+='<td colspan="2">'+(buy+sell).toFixed(3)+'</td>';});
    return h+'</tr></tbody></table>';
  }

  global.OrderFlowRender={ lineCvdSvg, profileSvg, footprintHtml };
})(typeof globalThis !== 'undefined' ? globalThis : window);
