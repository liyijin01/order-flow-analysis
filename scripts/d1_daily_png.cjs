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
  const manifest=[];let cutoff=null,levelsGeneratedAt=null,tpoGeneratedAt=null,ssdStatus=null;
  async function capture(symbol,tf,template,fileTf){
    const page=await browser.newPage({viewport:{width:1660,height:1300},deviceScaleFactor:1});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    const url=base+'?snapshot=1&tpl='+template+(template==='combined'?'&view=quarter':'')+'&symbol='+symbol+'&tf='+tf;
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
    const meta=await page.evaluate(({template,symbol})=>({
      status:document.getElementById('status').textContent,
      cutoff:window.__analysisDebug.model?.cutoffUtc,
      levelsGeneratedAt:window.__analysisDebug.state.bundle?.keyLevels?.generatedAt||null,
      tpoGeneratedAt:window.__analysisDebug.state.bundle?.tpo?.generatedAt||null,
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
      values:(()=>{
        const registry=window.OrderFlowTemplates||{};
        const handler=registry[template];
        return handler&&typeof handler.manifestValues==='function'
          ?handler.manifestValues({model:window.__analysisDebug.model})
          :null;
      })(),
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
    levelsGeneratedAt=levelsGeneratedAt||meta.levelsGeneratedAt;tpoGeneratedAt=tpoGeneratedAt||meta.tpoGeneratedAt;
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
  async function captureSsd(){
    const page=await browser.newPage({viewport:{width:1660,height:1100},deviceScaleFactor:1});
    try{
      await page.goto(base+'?snapshot=1&tpl=ssd&tf=1d',{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>{
        const text=document.getElementById('status')?.textContent||'';
        return text.startsWith('Loaded ')||text.startsWith('SSD 数据不可用');
      },undefined,{timeout:60000});
      const meta=await page.evaluate(()=>{
        const d=window.__analysisDebug,m=d&&d.model;
        if(!m||d.template()!=='ssd')return null;
        const handler=window.OrderFlowTemplates.ssd;
        return{
          status:document.getElementById('status').textContent,
          template:d.template(),date:m.date,points:m.points.length,
          generatedAt:m.generatedAt,values:handler.manifestValues({model:m}),
          levelSource:'manual · KBeast 2026-10-05',
          visibleLevels:m.levels.length
        };
      });
      if(!meta||!meta.points){
        const msg='SSD data unavailable; preserving existing analysis PNGs';
        console.warn('::warning::'+msg);
        if(process.env.D20_REQUIRE_SSD==='1')throw new Error(msg);
        return null;
      }
      const file=path.join(outDir,'SSD-1d.png');
      await page.locator('#analysisCapture').screenshot({path:file});
      const size=fs.statSync(file).size,height=fs.readFileSync(file).readUInt32BE(20);
      if(size<10*1024||height>900)throw new Error('SSD PNG invalid: '+size+' bytes / '+height+'px');
      manifest.push({
        symbol:'SSD',timeframe:'1d',template:'ssd',view:'full',
        file:'SSD-1d.png',bytes:size,height,status:meta.status,
        visibleBars:meta.points,logicalSlots:null,
        calcLastClosedUtc:meta.date+'T00:00:00Z',
        supply:0,demand:0,drawn:meta.visibleLevels,offView:0,
        regions:0,levels:meta.visibleLevels,keyLevels:meta.visibleLevels,
        values:meta.values,source:'CoinGecko',manualLevelSource:meta.levelSource
      });
      return{generatedAt:meta.generatedAt,lastDate:meta.date};
    }finally{await page.close();}
  }

  try{
    for(const symbol of symbols)for(const tf of combinedTfs)await capture(symbol,tf,'combined');
    for(const symbol of symbols)for(const tf of quarterTfs)await capture(symbol,tf,'quarter');
    for(const symbol of symbols)for(const tf of rvwapTfs)await capture(symbol,tf,'rvwap');
    for(const symbol of symbols)for(const tf of weeklyTfs)await capture(symbol,tf,'weekly');
    for(const symbol of symbols)for(const tf of monthlyTfs)await capture(symbol,tf,'monthly');
    for(const symbol of symbols)for(const tf of mprofileTfs)await capture(symbol,tf,'mprofile','30m');
    for(const symbol of symbols)for(const tf of wprofileTfs)await capture(symbol,tf,'wprofile','30m');
    ssdStatus=await captureSsd();
  } finally {await browser.close();}
  const latest={schema:'analysis-latest-v3',generatedAt:new Date().toISOString(),dataCutoffUtc:cutoff,symbols,timeframes:combinedTfs,templates:['combined','quarter','rvwap','weekly','monthly','mprofile','wprofile','ssd'],files:manifest};
  fs.writeFileSync(latestPath,JSON.stringify(latest,null,2));
  fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2));
  const status={generatedAt:latest.generatedAt,dataCutoffUtc:cutoff,levelsGeneratedAt,tpoGeneratedAt,
    ssdGeneratedAt:ssdStatus&&ssdStatus.generatedAt||null,ssdLastDate:ssdStatus&&ssdStatus.lastDate||null,
    pngCount:manifest.length};
  fs.writeFileSync(path.join(path.dirname(latestPath),'status.json'),JSON.stringify(status,null,2));
  const reference=manifest.find(x=>x.symbol==='BTCUSDT'&&x.template==='rvwap')?.reference;
  if(reference)console.log('D13 BTC reference '+JSON.stringify(reference));
  console.log('Generated '+manifest.length+' analysis PNGs; cutoff '+cutoff);
})().catch(e=>{console.error(e);process.exit(1);});
