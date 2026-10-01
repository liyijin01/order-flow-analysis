(function(global){
  'use strict';

  function nextPaint(){return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}
  function download(canvas,filename){
    return new Promise((resolve,reject)=>canvas.toBlob(blob=>{
      if(!blob)return reject(new Error('PNG encoding failed'));
      const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);resolve();
    },'image/png'));
  }
  function legend(ctx,x,y,entries){
    ctx.font='13px -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif';ctx.textBaseline='middle';
    let cx=x;
    for(const e of entries||[]){
      ctx.save();ctx.strokeStyle=e.color;ctx.fillStyle=e.color;ctx.lineWidth=2;
      if(e.kind==='box')ctx.fillRect(cx,y-6,12,12);
      else{if(e.kind==='dash')ctx.setLineDash([6,4]);ctx.beginPath();ctx.moveTo(cx,y);ctx.lineTo(cx+18,y);ctx.stroke();}
      ctx.restore();
      const labelX=cx+(e.kind==='box'?18:24);
      ctx.fillStyle='#cbd3e1';ctx.fillText(e.label,labelX,y);
      cx=labelX+ctx.measureText(e.label).width+26;
    }
  }
  function rowText(ctx,text,x,y,align){
    ctx.textAlign=align||'left';ctx.fillStyle='#cbd3e1';ctx.font='12px -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif';ctx.fillText(String(text),x,y);
  }

  async function exportBoard(options){
    const chart=options.chart,model=options.model,rows=options.rows||[],fmt=options.priceFormatter||String;
    await nextPaint();const shot=chart.takeScreenshot(true,false);
    const showLegend=options.legendEnabled!==false&&(options.legend||[]).length>0,showTable=options.tableEnabled!==false;
    const width=Math.max(1400,shot.width),chartH=Math.round(shot.height*width/shot.width),headerH=showLegend?86:50,rowH=24,tableHeaderH=34,footerH=36;
    const tableH=showTable?tableHeaderH+Math.max(1,rows.length)*rowH:0;
    const height=headerH+chartH+tableH+footerH;
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');
    ctx.fillStyle='#1b2130';ctx.fillRect(0,0,width,height);
    ctx.fillStyle='#f1f5f9';ctx.font='600 18px -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif';ctx.fillText(options.info||'',18,28);
    if(showLegend)legend(ctx,18,58,options.legend||[]);
    ctx.drawImage(shot,0,headerH,width,chartH);
    if(options.overlayLines&&options.overlayLines.length){ctx.save();ctx.textAlign='left';ctx.textBaseline='top';ctx.shadowColor='rgba(27,33,48,.9)';ctx.shadowBlur=3;ctx.font='12px -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif';for(let i=0;i<options.overlayLines.length;i++){ctx.fillStyle=i===0?'#cbd3e1':'#aeb7c8';ctx.fillText(String(options.overlayLines[i]||''),12,headerH+10+i*18);}ctx.restore();}

    if(showTable){
      const tableY=headerH+chartH;
      ctx.fillStyle='#161c29';ctx.fillRect(0,tableY,width,tableH);
      ctx.strokeStyle='rgba(255,255,255,.12)';ctx.beginPath();ctx.moveTo(0,tableY);ctx.lineTo(width,tableY);ctx.stroke();
      const cols=[18,width*.25,width*.48,width*.61,width*.73,width*.87];
      const heads=['类型','价格区间','距现价 %','状态','计算周期','数据来源'];
      ctx.font='600 12px -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif';ctx.fillStyle='#e7eaf0';
      for(let i=0;i<heads.length;i++)ctx.fillText(heads[i],cols[i],tableY+22);
      for(let i=0;i<rows.length;i++){
        const r=rows[i],y=tableY+tableHeaderH+i*rowH+16;
        const range=r.missing||r.summary?'—':(r.low===r.high?fmt(r.low):fmt(r.low)+' – '+fmt(r.high));
        const dist=r.distance==null?'—':Number(r.distance).toFixed(2)+'%';
        const vals=[r.type,range,dist,r.status,r.period,r.source||'—'];
        for(let j=0;j<vals.length;j++)rowText(ctx,vals[j],cols[j],y,'left');
      }
    }
    const footerY=height-14;rowText(ctx,'order-flow-analysis · read only',18,footerY,'left');
    ctx.textAlign='right';ctx.fillStyle='#8e98aa';ctx.font='11px -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif';
    const footer=options.footer||'实时 Binance USD-M';
    ctx.fillText(footer,width-18,footerY);
    await download(canvas,options.filename||'analysis.png');
    return{width,height};
  }

  async function exportFlowBoard(options){
    await nextPaint();
    const shot=options.chart.takeScreenshot(true,false);
    const width=Math.max(1400,shot.width),chartH=Math.round(shot.height*width/shot.width),headerH=70,rowH=23;
    const rows=options.rows||[],tableH=34+rows.length*rowH,footerH=34,height=headerH+chartH+tableH+footerH;
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');
    ctx.fillStyle='#1b2130';ctx.fillRect(0,0,width,height);
    ctx.fillStyle='#f1f5f9';ctx.font='600 18px -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif';ctx.fillText(options.title||'',18,27);
    ctx.fillStyle='#9aa6bb';ctx.font='12px -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif';ctx.fillText(options.info||'',18,50);
    ctx.drawImage(shot,0,headerH,width,chartH);
    for(const p of options.paneLabels||[]){
      ctx.fillStyle='#e7eaf0';ctx.font='600 12px -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif';
      ctx.fillText(String(p.text||''),14,headerH+Number(p.y||0)+16);
    }
    const tableY=headerH+chartH;ctx.fillStyle='#161c29';ctx.fillRect(0,tableY,width,tableH);
    ctx.fillStyle='#e7eaf0';ctx.font='600 12px -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif';ctx.fillText('FLOW SUMMARY',18,tableY+22);
    ctx.font='12px -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif';
    for(let i=0;i<rows.length;i++){ctx.fillStyle='#cbd3e1';ctx.fillText(String(rows[i]),18,tableY+34+i*rowH+16);}
    rowText(ctx,'order-flow-analysis · read only',18,height-14,'left');
    ctx.textAlign='right';ctx.fillStyle='#8e98aa';ctx.font='11px -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif';ctx.fillText(options.footer||'',width-18,height-14);
    await download(canvas,options.filename||'flow.png');
    return{width,height};
  }

  global.OrderFlowAnalysisExport={exportBoard,exportFlowBoard};
})(typeof globalThis!=='undefined'?globalThis:window);
