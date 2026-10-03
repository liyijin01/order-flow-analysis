const {chromium}=require('playwright-core');
const fs=require('fs'),path=require('path');

const base=process.env.ANALYSIS_URL||'http://127.0.0.1:8000/analysis.html';
const outDir=path.resolve(process.env.ANALYSIS_PNG_DIR||'_site/analysis/png');
const latestPath=path.resolve(process.env.ANALYSIS_LATEST||'_site/analysis/latest.json');
fs.mkdirSync(outDir,{recursive:true});
fs.mkdirSync(path.dirname(latestPath),{recursive:true});

const symbols=['BTCUSDT','ETHUSDT','SOLUSDT'],combinedTfs=['4h','1h','1d'],quarterTfs=['1h','4h'];
const calcMs={'1h':4*3600_000,'4h':86400_000,'1d':7*86400_000};

(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const manifest=[];let cutoff=null;
  async function capture(symbol,tf,template){
    const page=await browser.newPage({viewport:{width:1660,height:1300},deviceScaleFactor:1});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    const url=base+'?snapshot=1&tpl='+template+(template==='combined'?'&view=quarter':'')+'&symbol='+symbol+'&tf='+tf;
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
    const meta=await page.evaluate(()=>({
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
      tableRows:window.__analysisDebug.model?.tableRows?.length||0
    }));
    if(errors.length)throw new Error(symbol+' '+tf+' '+template+' browser errors: '+errors.join(' | '));
    if(meta.template!==template)throw new Error(symbol+' '+tf+' template mismatch '+JSON.stringify(meta));
    for(const a of meta.axis.filter(x=>x.visible))if(a.diff==null||a.diff>1)throw new Error(symbol+' '+tf+' '+template+' axis label diff '+JSON.stringify(a));
    if(template==='combined'){
      if(!(Number.isFinite(meta.logicalSlots)&&Math.abs(meta.logicalSlots-meta.visibleBars*1.04)<=2))throw new Error(symbol+' '+tf+' combined quarter logical slots '+meta.logicalSlots+' expected '+(meta.visibleBars*1.04));
    }else{
      if(meta.tableVisible||meta.legendVisible)throw new Error(symbol+' '+tf+' quarter template chrome visible '+JSON.stringify(meta));
      const r=meta.range||{},right=Math.max(0,Number(r.to)-(meta.displayBars-1)),span=Number(r.to)-Number(r.from),fraction=span>0?right/span:0;
      if(Math.abs(fraction-.18)>.025)throw new Error(symbol+' '+tf+' quarter right margin '+fraction);
    }
    if(!meta.cutoff||!meta.calcLastClosedUtc)throw new Error(symbol+' '+tf+' '+template+' missing cutoff metadata');
    const cutoffMs=Date.parse(meta.cutoff),calcMsValue=Date.parse(meta.calcLastClosedUtc),earliest=cutoffMs-(calcMs[tf]+86400_000);
    if(calcMsValue<earliest)throw new Error(symbol+' '+tf+' '+template+' calcLastClosedUtc too stale: '+meta.calcLastClosedUtc+' cutoff '+meta.cutoff);
    cutoff=cutoff||meta.cutoff;if(cutoff!==meta.cutoff)throw new Error('snapshot cutoffs disagree: '+cutoff+' vs '+meta.cutoff);
    const fileName=template==='quarter'?symbol+'-quarter-'+tf+'.png':symbol+'-'+tf+'.png',file=path.join(outDir,fileName);
    await page.locator('#analysisCapture').screenshot({path:file});
    const size=fs.statSync(file).size;if(size<50*1024)throw new Error(file+' is only '+size+' bytes');
    const png=fs.readFileSync(file),height=png.readUInt32BE(20);
    const combinedMaxHeight=140+760+34+Math.max(1,meta.tableRows)*24+36+20;
    const maxHeight=template==='quarter'?900:combinedMaxHeight;
    if(height>maxHeight)throw new Error(file+' height '+height+' exceeds '+maxHeight+'px for '+meta.tableRows+' table rows');
    manifest.push({
      symbol,timeframe:tf,template,view:meta.windowMode,file:path.basename(file),bytes:size,height,status:meta.status,
      visibleBars:meta.visibleBars,logicalSlots:meta.logicalSlots,calcLastClosedUtc:meta.calcLastClosedUtc,
      supply:meta.supply,demand:meta.demand,drawn:meta.drawn,offView:meta.offView,regions:meta.regions,levels:meta.levels,keyLevels:meta.keyLevels
    });
    await page.close();
  }
  try{
    for(const symbol of symbols)for(const tf of combinedTfs)await capture(symbol,tf,'combined');
    for(const symbol of symbols)for(const tf of quarterTfs)await capture(symbol,tf,'quarter');
  } finally {await browser.close();}
  const latest={schema:'analysis-latest-v3',generatedAt:new Date().toISOString(),dataCutoffUtc:cutoff,symbols,timeframes:combinedTfs,templates:['combined','quarter'],files:manifest};
  fs.writeFileSync(latestPath,JSON.stringify(latest,null,2));
  fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2));
  console.log('Generated '+manifest.length+' analysis PNGs; cutoff '+cutoff);
})().catch(e=>{console.error(e);process.exit(1);});
