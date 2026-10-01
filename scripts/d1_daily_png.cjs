const {chromium}=require('playwright-core');
const fs=require('fs'),path=require('path');

const base=process.env.ANALYSIS_URL||'http://127.0.0.1:8000/analysis.html';
const outDir=path.resolve(process.env.ANALYSIS_PNG_DIR||'_site/analysis/png');
const latestPath=path.resolve(process.env.ANALYSIS_LATEST||'_site/analysis/latest.json');
fs.mkdirSync(outDir,{recursive:true});
fs.mkdirSync(path.dirname(latestPath),{recursive:true});

const symbols=['BTCUSDT','ETHUSDT','SOLUSDT'],tfs=['4h','1h','1d'];
const rightOffset=30;
const calcMs={'1h':4*3600_000,'4h':86400_000,'1d':7*86400_000};

(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const manifest=[];let cutoff=null;
  try{
    for(const symbol of symbols){
      for(const tf of tfs){
        const page=await browser.newPage({viewport:{width:1660,height:1300},deviceScaleFactor:1});
        const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
        const url=base+'?snapshot=1&view=quarter&symbol='+symbol+'&tf='+tf;
        await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
        await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
        const meta=await page.evaluate(()=>({
          status:document.getElementById('status').textContent,
          cutoff:window.__analysisDebug.model?.cutoffUtc,
          visibleBars:window.__analysisDebug.model?.visibleBars||0,
          logicalSlots:window.__analysisDebug.view()?.logicalSlots,
          calcLastClosedUtc:window.__analysisDebug.model?.calcLastClosedUtc,
          supply:(window.__analysisDebug.model?.regions||[]).filter(x=>x.type==='supply').length,
          demand:(window.__analysisDebug.model?.regions||[]).filter(x=>x.type==='demand').length,
          drawn:(window.__analysisDebug.model?.regions||[]).length+(window.__analysisDebug.model?.levels||[]).length,
          offView:(window.__analysisDebug.model?.allRegions||[]).filter(x=>x.offView).length+(window.__analysisDebug.model?.allLevels||[]).filter(x=>x.offView).length,
          regions:window.__analysisDebug.model?.regions?.length||0,
          levels:window.__analysisDebug.model?.levels?.length||0,
          keyLevels:window.__analysisDebug.model?.keyLevels?.length||0,
          axis:window.__analysisDebug.axisLabels()
        }));
        if(errors.length)throw new Error(symbol+' '+tf+' browser errors: '+errors.join(' | '));
        for(const a of meta.axis.filter(x=>x.visible))if(a.diff==null||a.diff>1)throw new Error(symbol+' '+tf+' axis label diff '+JSON.stringify(a));
        if(!(Number.isFinite(meta.logicalSlots)&&Math.abs(meta.logicalSlots-meta.visibleBars*1.04)<=2)){
          throw new Error(symbol+' '+tf+' quarter logical slots '+meta.logicalSlots+' expected '+(meta.visibleBars*1.04));
        }
        if(!meta.cutoff||!meta.calcLastClosedUtc)throw new Error(symbol+' '+tf+' missing cutoff metadata');
        const cutoffMs=Date.parse(meta.cutoff),calcMsValue=Date.parse(meta.calcLastClosedUtc);
        const earliest=cutoffMs-(calcMs[tf]+86400_000);
        if(calcMsValue<earliest)throw new Error(symbol+' '+tf+' calcLastClosedUtc too stale: '+meta.calcLastClosedUtc+' cutoff '+meta.cutoff);
        cutoff=cutoff||meta.cutoff;
        if(cutoff!==meta.cutoff)throw new Error('snapshot cutoffs disagree: '+cutoff+' vs '+meta.cutoff);
        const file=path.join(outDir,symbol+'-'+tf+'.png');
        await page.locator('#analysisCapture').screenshot({path:file});
        const size=fs.statSync(file).size;if(size<50*1024)throw new Error(file+' is only '+size+' bytes');
        manifest.push({
          symbol,timeframe:tf,view:'quarter',file:path.basename(file),bytes:size,status:meta.status,
          visibleBars:meta.visibleBars,logicalSlots:meta.logicalSlots,calcLastClosedUtc:meta.calcLastClosedUtc,
          supply:meta.supply,demand:meta.demand,drawn:meta.drawn,offView:meta.offView,
          regions:meta.regions,levels:meta.levels,keyLevels:meta.keyLevels
        });
        await page.close();
      }
    }
  } finally {await browser.close();}
  const latest={
    schema:'analysis-latest-v2',
    generatedAt:new Date().toISOString(),
    dataCutoffUtc:cutoff,
    symbols,
    timeframes:tfs,
    files:manifest
  };
  fs.writeFileSync(latestPath,JSON.stringify(latest,null,2));
  fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2));
  console.log('Generated '+manifest.length+' analysis PNGs; cutoff '+cutoff);
})().catch(e=>{console.error(e);process.exit(1);});
