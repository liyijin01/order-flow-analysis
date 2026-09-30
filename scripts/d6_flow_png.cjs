const {chromium}=require('playwright-core');
const fs=require('fs'),path=require('path');

const base=process.env.FLOW_URL||'http://127.0.0.1:8000/flow.html';
const outDir=path.resolve(process.env.FLOW_PNG_DIR||'_site/flow/png');
const latestPath=path.resolve(process.env.FLOW_LATEST||'_site/flow/latest.json');
fs.mkdirSync(outDir,{recursive:true});fs.mkdirSync(path.dirname(latestPath),{recursive:true});
const symbols=['BTCUSDT','ETHUSDT','SOLUSDT'],tfs=['15m','30m'];

(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const files=[];let cutoff=null;
  try{
    for(const symbol of symbols){
      const depthUrl=new URL('flow/data/depth-'+symbol+'.json',base).href;
      const depthResponse=await fetch(depthUrl);
      if(!depthResponse.ok)throw new Error(symbol+' depth HTTP '+depthResponse.status);
      const depthBytes=(await depthResponse.arrayBuffer()).byteLength;
      if(depthBytes>=300*1024)throw new Error(symbol+' depth JSON is '+depthBytes+' bytes; expected < 300KB');
      for(const tf of tfs){
        const page=await browser.newPage({viewport:{width:1600,height:1500},deviceScaleFactor:1});
        const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
        await page.goto(base+'?snapshot=1&anchor=swing&symbol='+symbol+'&tf='+tf,{waitUntil:'domcontentloaded',timeout:60000});
        await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),{timeout:60000});
        const meta=await page.evaluate(()=>{
          const d=window.__flowDebug,m=d.model,v=d.view(),depth=m.depth||{};
          return{
            status:document.getElementById('status').textContent,cutoffUtc:m.cutoffUtc,
            visibleBars:m.visibleBars,logicalSlots:v.logicalSlots,
            avwap:{anchorMode:m.anchor.mode,anchorTime:new Date(m.anchor.time*1000).toISOString(),anchorPrice:m.anchor.price,
              vwap:m.lastAv.vwap,s1u:m.lastAv.s1u,s1l:m.lastAv.s1l,s2u:m.lastAv.s2u,s2l:m.lastAv.s2l},
            cvd:{anchorTime:new Date(m.cvdAnchorTime*1000).toISOString(),perp:m.perp.value,spot:m.spot.value,
              perpBars:m.perp.matched,spotBars:m.spot.matched,missingPerp:m.perp.missing,missingSpot:m.spot.missing},
            depth:{bucketsUsed:m.buckets,cutoffUtc:m.depthCutoffUtc,snapshotsUsed:depth.snapshotsUsed||0,
              snapshotsRejected:m.depthRejected,emptyBars:depth.emptyBars||0,totalSnapshots:m.depthTotal,
              rawSnapshots:m.depthRawTotal,invalidSnapshots:m.depthInvalidSnapshots,invalidDays:m.depthInvalidDays}
          };
        });
        if(errors.length)throw new Error(symbol+' '+tf+' browser errors: '+errors.join(' | '));
        if(meta.avwap.anchorMode!=='swing')throw new Error(symbol+' '+tf+' PNG anchor is not swing');
        const anchorMs=Date.parse(meta.avwap.anchorTime),cutoffMs=Date.parse(meta.cutoffUtc);
        if(!(anchorMs>=cutoffMs-15*86400000&&anchorMs<=cutoffMs))throw new Error(symbol+' '+tf+' swing anchor outside lookback '+JSON.stringify(meta.avwap));
        const rejectedPct=meta.depth.totalSnapshots?100*meta.depth.snapshotsRejected/meta.depth.totalSnapshots:100;
        if(!(rejectedPct<5))throw new Error(symbol+' '+tf+' rejected depth '+rejectedPct.toFixed(3)+'%');
        if(JSON.stringify(meta.depth.bucketsUsed)!==JSON.stringify([[0,1],[1,2],[2,5]]))throw new Error(symbol+' '+tf+' unexpected buckets '+JSON.stringify(meta.depth.bucketsUsed));
        cutoff=cutoff||meta.cutoffUtc;if(cutoff!==meta.cutoffUtc)throw new Error('flow snapshot cutoff mismatch');
        const file=path.join(outDir,symbol+'-flow-'+tf+'.png');
        const box=await page.locator('#flowCapture').boundingBox();
        if(!box||Math.round(box.width)!==1600)throw new Error(symbol+' '+tf+' flow PNG width '+JSON.stringify(box));
        await page.locator('#flowCapture').screenshot({path:file});
        const size=fs.statSync(file).size;if(size<50*1024)throw new Error(file+' is only '+size+' bytes');
        files.push({symbol,tf,file:path.basename(file),bytes:size,depthFileBytes:depthBytes,cutoffUtc:meta.cutoffUtc,visibleBars:meta.visibleBars,logicalSlots:meta.logicalSlots,avwap:meta.avwap,cvd:meta.cvd,depth:meta.depth});
        await page.close();
      }
    }
  }finally{await browser.close();}
  const latest={schema:'flow-latest-v1',generatedAt:new Date().toISOString(),dataCutoffUtc:cutoff,symbols,timeframes:tfs,files};
  fs.writeFileSync(latestPath,JSON.stringify(latest,null,2));fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(files,null,2));
  console.log('Generated '+files.length+' flow PNGs; cutoff '+cutoff);
})().catch(e=>{console.error(e);process.exit(1);});
