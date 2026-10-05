const {chromium}=require('playwright-core');
const fs=require('fs'),path=require('path');

const base=process.env.ANALYSIS_URL||'http://127.0.0.1:8000/analysis.html';
const outDir=path.resolve(process.env.ANALYSIS_PNG_DIR||'_site/analysis/png');
const latestPath=path.resolve(process.env.ANALYSIS_LATEST||'_site/analysis/latest.json');
fs.mkdirSync(outDir,{recursive:true});
fs.mkdirSync(path.dirname(latestPath),{recursive:true});

const symbols=['BTCUSDT','ETHUSDT','SOLUSDT'],combinedTfs=['4h','1h','1d'],quarterTfs=['1h','4h'],rvwapTfs=['4h'],weeklyTfs=['30m'],monthlyTfs=['1M'],mprofileTfs=['1d'],wprofileTfs=['1d'];
const calcMs={'30m':4*3600_000,'1h':4*3600_000,'4h':86400_000,'1d':7*86400_000,'1M':86400_000};

(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const manifest=[];let cutoff=null;
  async function capture(symbol,tf,template,fileTf){
    const page=await browser.newPage({viewport:{width:1660,height:1300},deviceScaleFactor:1});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    const url=base+'?snapshot=1&tpl='+template+(template==='combined'?'&view=quarter':'')+'&symbol='+symbol+'&tf='+tf;
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
    const meta=await page.evaluate(({template,symbol})=>({
      status:document.getElementById('status').textContent,
      cutoff:window.__analysisDebug.model?.cutoffUtc,
      template:window.__analysisDebug.template(),
      windowMode:window.__analysisDebug.windowSpec().mode,
      visibleBars:window.__analysisDebug.model?.visibleBars||0,
      displayBars:window.__analysisDebug.model?.display?.length||0,
      range:window.__analysisDebug.view()?.range,
      logicalSlots:window.__analysisDebug.view()?.logicalSlots,
      calcLastClosedUtc:window.__analysisDebug.model?.calcLastClosedUtc,
      supply:(window.__analysisDebug.model?.regions||[]).filter(x=>x.type==='supply').length,
      demand:(window.__analysisDebug.model?.regions||[]).filter(x=>x.type==='demand').length,
      drawn:(window.__analysisDebug.model?.regions||[]).length+(window.__analysisDebug.model?.levels||[]).length,
      offView:(window.__analysisDebug.model?.allRegions||[]).filter(x=>x.offView).length+(window.__analysisDebug.model?.allLevels||[]).filter(x=>x.offView).length,
      regions:window.__analysisDebug.model?.regions?.length||0,
      levels:window.__analysisDebug.model?.levels?.length||0,
      keyLevels:window.__analysisDebug.model?.keyLevels?.length||0,
      tableVisible:getComputedStyle(document.querySelector('.table-wrap')).display!=='none',
      legendVisible:getComputedStyle(document.getElementById('analysisLegend')).display!=='none',
      axis:window.__analysisDebug.axisLabels(),
      tableRows:window.__analysisDebug.model?.tableRows?.length||0,
      values:(template==='weekly'?(()=>{
        const m=window.__analysisDebug.model,last=Number(m.last.time),seg=(m.weekly&&m.weekly.segments||[]).find(x=>last>=Number(x.start)&&last<Number(x.end));
        const p=seg&&(seg.points||[]).find(x=>Number(x.time)===last),proj=seg&&(m.weekly&&m.weekly.projections||[]).find(x=>Number(x.weekStart)===Number(seg.start));
        return{weekStart:seg&&seg.start,vwap:p&&p.vwap,upper:p&&p.upper,lower:p&&p.lower,pwVwap:proj&&proj.pwVwap,pwUpper:proj&&proj.pwUpper,pwLower:proj&&proj.pwLower,yearOpen:m.weekly&&m.weekly.yearOpen};
      })():template==='monthly'?(()=>{
        const mm=window.__analysisDebug.model?.monthly||{},line=x=>x?{price:x.price,label:x.label,month:x.month}:null,g=mm.imbalance;
        return{upper:line(mm.upper),lower:line(mm.lower),imbalance:g?{low:g.low,high:g.high,c1:g.c1Month,c3:g.c3Month,forming:!!g.forming}:null};
      })():template==='mprofile'?(()=>{
        const mp=window.__analysisDebug.model?.mprofile||{},box=mp.box;
        return{currentPoc:mp.current&&mp.current.poc,box:box?{month:new Date(box.startSec*1000).toISOString().slice(0,7),vah:box.vah,val:box.val}:null,
          naked:(mp.naked||[]).map(x=>({month:new Date(x.from*1000).toISOString().slice(0,7),side:x.side,price:x.price,touchedThisPeriod:!!x.touchedThisPeriod})),
          singlePrints:(mp.singlePrints||[]).map(x=>({month:new Date(x.from*1000).toISOString().slice(0,7),bottom:x.bottom,top:x.top}))};
      })():template==='wprofile'?(()=>{
        const wp=window.__analysisDebug.model?.wprofile||{},ref=wp.reference,rs=ref&&Date.parse(String(ref.start))/1000;
        return{currentPoc:wp.current&&wp.current.poc,reference:ref?{week:new Date(rs*1000).toISOString().slice(0,10),high:Number(ref.high),low:Number(ref.low),manual:!!ref.manual}:null,
          naked:(wp.naked||[]).map(x=>({week:new Date(x.from*1000).toISOString().slice(0,10),side:x.side,price:x.price,touchedThisPeriod:!!x.touchedThisPeriod})),
          singlePrints:(wp.singlePrints||[]).map(x=>({week:new Date(x.from*1000).toISOString().slice(0,10),bottom:x.bottom,top:x.top}))};
      })():null),
      reference:(template==='rvwap'&&symbol==='BTCUSDT'?(()=>{
        const d=window.__analysisDebug,m=d.model,target=Date.UTC(2026,8,30,16,0,0)/1000,curves=m.curves||[];
        const cv=id=>{const c=curves.find(x=>x.id===id),p=c&&c.points.find(x=>Number(x.time)===target);return p&&p.value;};
        const ys=(m.rvwap&&m.rvwap.yearSegments||[]).find(x=>target>=x.start&&target<x.end),yp=ys&&ys.points.find(x=>Number(x.time)===target);
        const l=(m.yearLevels||[]).find(x=>x.label==='2024 VAH');
        return{targetUtc:new Date(target*1000).toISOString(),yVwap:yp&&yp.vwap,yUpper:yp&&yp.upper,yLower:yp&&yp.lower,rvwap30:cv('rvwap-30'),rvwap60:cv('rvwap-60'),rvwap90:cv('rvwap-90'),rvwap365:cv('rvwap-365'),y2024Vah:l&&l.price};
      })():null)
    }),{template,symbol});
    if(errors.length)throw new Error(symbol+' '+tf+' '+template+' browser errors: '+errors.join(' | '));
    if(meta.template!==template)throw new Error(symbol+' '+tf+' template mismatch '+JSON.stringify(meta));
    for(const a of meta.axis.filter(x=>x.visible))if(a.diff==null||a.diff>1)throw new Error(symbol+' '+tf+' '+template+' axis label diff '+JSON.stringify(a));
    if(template==='combined'){
      if(!(Number.isFinite(meta.logicalSlots)&&Math.abs(meta.logicalSlots-meta.visibleBars*1.04)<=2))throw new Error(symbol+' '+tf+' combined quarter logical slots '+meta.logicalSlots+' expected '+(meta.visibleBars*1.04));
    }else{
      if(meta.tableVisible||meta.legendVisible)throw new Error(symbol+' '+tf+' template chrome visible '+JSON.stringify(meta));
      const r=meta.range||{},right=Math.max(0,Number(r.to)-(meta.displayBars-1)),span=Number(r.to)-Number(r.from),fraction=span>0?right/span:0,expected=(template==='mprofile'||template==='wprofile')?.30:.18;
      if(Math.abs(fraction-expected)>.025)throw new Error(symbol+' '+tf+' '+template+' right margin '+fraction);
    }
    if(template==='weekly'){
      const v=meta.values||{},keys=['weekStart','vwap','upper','lower','pwVwap','pwUpper','pwLower','yearOpen'];
      if(keys.some(k=>!Number.isFinite(Number(v[k]))))throw new Error(symbol+' '+tf+' weekly values incomplete '+JSON.stringify(v));
    }
    if(template==='mprofile'){
      const v=meta.values||{};if(!Number.isFinite(Number(v.currentPoc))||!Array.isArray(v.naked)||!Array.isArray(v.singlePrints))throw new Error(symbol+' '+tf+' mprofile values incomplete '+JSON.stringify(v));
    }
    if(template==='wprofile'){
      const v=meta.values||{};if(!Number.isFinite(Number(v.currentPoc))||!Array.isArray(v.naked)||!Array.isArray(v.singlePrints))throw new Error(symbol+' '+tf+' wprofile values incomplete '+JSON.stringify(v));
    }
    if(!meta.cutoff||!meta.calcLastClosedUtc)throw new Error(symbol+' '+tf+' '+template+' missing cutoff metadata');
    const cutoffMs=Date.parse(meta.cutoff),calcMsValue=Date.parse(meta.calcLastClosedUtc),earliest=cutoffMs-(calcMs[tf]+86400_000);
    if(calcMsValue<earliest)throw new Error(symbol+' '+tf+' '+template+' calcLastClosedUtc too stale: '+meta.calcLastClosedUtc+' cutoff '+meta.cutoff);
    cutoff=cutoff||meta.cutoff;if(cutoff!==meta.cutoff)throw new Error('snapshot cutoffs disagree: '+cutoff+' vs '+meta.cutoff);
    const outputTf=fileTf||tf,fileName=template==='combined'?symbol+'-'+outputTf+'.png':symbol+'-'+template+'-'+outputTf+'.png',file=path.join(outDir,fileName);
    await page.locator('#analysisCapture').screenshot({path:file});
    const size=fs.statSync(file).size;if(size<50*1024)throw new Error(file+' is only '+size+' bytes');
    const png=fs.readFileSync(file),height=png.readUInt32BE(20);
    const combinedMaxHeight=140+760+34+Math.max(1,meta.tableRows)*24+36+20;
    const maxHeight=template==='combined'?combinedMaxHeight:900;
    if(height>maxHeight)throw new Error(file+' height '+height+' exceeds '+maxHeight+'px for '+meta.tableRows+' table rows');
    manifest.push({
      symbol,timeframe:outputTf,template,view:meta.windowMode,file:path.basename(file),bytes:size,height,status:meta.status,
      visibleBars:meta.visibleBars,logicalSlots:meta.logicalSlots,calcLastClosedUtc:meta.calcLastClosedUtc,
      supply:meta.supply,demand:meta.demand,drawn:meta.drawn,offView:meta.offView,regions:meta.regions,levels:meta.levels,keyLevels:meta.keyLevels,values:meta.values,reference:meta.reference
    });
    await page.close();
  }
  try{
    for(const symbol of symbols)for(const tf of combinedTfs)await capture(symbol,tf,'combined');
    for(const symbol of symbols)for(const tf of quarterTfs)await capture(symbol,tf,'quarter');
    for(const symbol of symbols)for(const tf of rvwapTfs)await capture(symbol,tf,'rvwap');
    for(const symbol of symbols)for(const tf of weeklyTfs)await capture(symbol,tf,'weekly');
    for(const symbol of symbols)for(const tf of monthlyTfs)await capture(symbol,tf,'monthly');
    for(const symbol of symbols)for(const tf of mprofileTfs)await capture(symbol,tf,'mprofile','30m');
    for(const symbol of symbols)for(const tf of wprofileTfs)await capture(symbol,tf,'wprofile','30m');
  } finally {await browser.close();}
  const latest={schema:'analysis-latest-v3',generatedAt:new Date().toISOString(),dataCutoffUtc:cutoff,symbols,timeframes:combinedTfs,templates:['combined','quarter','rvwap','weekly','monthly','mprofile','wprofile'],files:manifest};
  fs.writeFileSync(latestPath,JSON.stringify(latest,null,2));
  fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2));
  const reference=manifest.find(x=>x.symbol==='BTCUSDT'&&x.template==='rvwap')?.reference;
  if(reference)console.log('D13 BTC reference '+JSON.stringify(reference));
  console.log('Generated '+manifest.length+' analysis PNGs; cutoff '+cutoff);
})().catch(e=>{console.error(e);process.exit(1);});
