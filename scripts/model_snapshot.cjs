const {chromium}=require('playwright-core');
const crypto=require('crypto');
const fs=require('fs');
const {
  routeMarket,routeKeyLevels,routeProfiles,routeTpo,routeSyntheticSnapshot
}=require('./smoke/helpers.cjs');

const pageUrl=process.argv[2];
const output=process.argv[3];
if(!pageUrl||!output){
  console.error('usage: node scripts/model_snapshot.cjs <analysis-page-url> <output-json>');
  process.exit(2);
}

const FIXED_TIME='2026-09-27T12:00:00Z';
const templates=[
  ['quarter',['1h','4h']],
  ['rvwap',['4h']],
  ['weekly',['30m']],
  ['monthly',['1M']],
  ['mprofile',['1d']],
  ['wprofile',['1d']],
  ['combined',['4h','1h','1d']]
];
const defaultTimeframes={
  quarter:'1h',rvwap:'4h',weekly:'30m',monthly:'1M',mprofile:'1d',wprofile:'1d',combined:'4h'
};
const symbols=['BTCUSDT','ETHUSDT','SOLUSDT'];

function compactPoint(p){
  if(!p)return null;
  const out={};
  for(const key of ['time','value','vwap','upper','lower'])if(p[key]!=null)out[key]=Number(p[key]);
  return out;
}

function stableValue(value){
  if(typeof value==='number')return Number.isFinite(value)?Number(value.toPrecision(10)):String(value);
  if(Array.isArray(value))return value.map(stableValue);
  if(value&&typeof value==='object'){
    const out={};
    for(const key of Object.keys(value).sort())out[key]=stableValue(value[key]);
    return out;
  }
  return value;
}

function sha1(value){
  return crypto.createHash('sha1').update(JSON.stringify(stableValue(value))).digest('hex');
}

async function capture(browser,symbol,template,timeframe,snapshotMode){
  const page=await browser.newPage({viewport:{width:1600,height:1000}});
  await page.clock.setFixedTime(FIXED_TIME);
  const requests=[];
  await routeMarket(page,requests);
  await routeKeyLevels(page,'fixture');
  await routeProfiles(page,FIXED_TIME);
  await routeTpo(page,FIXED_TIME);
  if(snapshotMode)await routeSyntheticSnapshot(page,FIXED_TIME);
  const query='?symbol='+encodeURIComponent(symbol)+'&tpl='+encodeURIComponent(template)+'&tf='+encodeURIComponent(timeframe)+(snapshotMode?'&snapshot=1':'');
  await page.goto(pageUrl+query,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),undefined,{timeout:60000});
  // Measure requests from the initial page load, before any layout-stabilization refresh.
  const openingRequests=requests.map(x=>({interval:x.interval,limit:x.limit}));
  // Key-level selection includes a pixel gap. After initial loading, wait for the chart
  // pane and volume pane to settle, then rebuild the model at their final dimensions.
  await page.waitForTimeout(400);
  await page.evaluate(async()=>{
    const root=document.getElementById('analysisChart');
    const debug=window.__analysisDebug;
    debug.state.chart.resize(root.clientWidth,root.clientHeight);
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    await debug.refresh(true);
  });
  await page.waitForTimeout(200);
  const summary=await page.evaluate(()=>{
    const d=window.__analysisDebug,m=d.model,primitive=d.state.primitive&&d.state.primitive.model||{};
    const pick=(obj,keys)=>{
      const out={};for(const key of keys)if(obj&&obj[key]!=null)out[key]=obj[key];return out;
    };
    const curves=(m.curves||[]).map(c=>({
      id:c.id,points:(c.points||[]).length,first:(c.points||[])[0]||null,last:(c.points||[]).length?(c.points||[])[(c.points||[]).length-1]:null,
      allPoints:c.points||[]
    }));
    const profiles=(m.profiles||[]).map(p=>({
      start:Number(p.start),poc:Number(p.poc),vah:Number(p.vah),val:Number(p.val),rows:Array.isArray(p.rows)?p.rows.length:0,
      allRows:p.rows||[]
    }));
    const template=d.template();
    const handler=(window.OrderFlowTemplates||{})[template];
    const manifestValues=handler&&typeof handler.manifestValues==='function'?handler.manifestValues({model:m}):null;
    const singlePrints=((m.mprofile&&m.mprofile.singlePrints)||(m.wprofile&&m.wprofile.singlePrints)||[]).map(x=>[Number(x.bottom),Number(x.top)]);
    const candleStyle=d.candleStyle()||{},chartInfo=d.chartInfo()||{};
    return{
      display:{count:m.display.length,first:m.display.length?Number(m.display[0].time):null,last:m.display.length?Number(m.display[m.display.length-1].time):null},
      levels:(m.levels||[]).map(x=>pick(x,['id','kind','price','from','to','style','color','label','axisLabel','naked','touchedThisPeriod'])),
      regions:(m.regions||[]).map(x=>pick(x,['id','scope','type','bottom','top','from','to'])),
      curves,
      profiles,
      singlePrints,
      infoValues:m.infoValues||null,
      infoLines:[document.getElementById('chartInfo1')?.textContent||'',document.getElementById('chartInfo2')?.textContent||''],
      axisLabels:d.axisLabels().filter(x=>x.visible).map(x=>x.id),
      defaultRange:d.state.defaultViewRange?{from:Number(d.state.defaultViewRange.from),to:Number(d.state.defaultViewRange.to)}:null,
      autoscale:{min:Number(primitive.autoscaleMin),max:Number(primitive.autoscaleMax)},
      calcLastClosedUtc:m.calcLastClosedUtc||null,
      manifestValues,
      appearance:{
        candles:{upColor:candleStyle.upColor||null,downColor:candleStyle.downColor||null,visible:candleStyle.visible!==false},
        watermark:{text:chartInfo.watermark||null,color:chartInfo.watermarkColor||null},
        legendVisible:getComputedStyle(document.getElementById('analysisLegend')).display!=='none',
        tableVisible:getComputedStyle(document.querySelector('.table-wrap')).display!=='none',
        volumeVisible:!!d.state.volume,
        activeTimeframe:document.querySelector('[data-tf].active')?.dataset.tf||null,
        activeTemplate:document.querySelector('[data-tpl].active')?.dataset.tpl||null,
        countdown:!!(d.state.primitive&&d.state.primitive.model&&d.state.primitive.model.countdown)
      }
    };
  });
  const curveHashes=summary.curves.map(c=>({id:c.id,sha1:sha1(c.allPoints)}));
  const profileHashes=summary.profiles.map(p=>({start:p.start,sha1:sha1(p.allRows)}));
  const singlePrintHashes=summary.singlePrints.map((x,i)=>({index:i,sha1:sha1(x)}));
  summary.curves=summary.curves.map(c=>({
    id:c.id,points:c.points,first:compactPoint(c.first),last:compactPoint(c.last)
  }));
  summary.profiles=summary.profiles.map(p=>({start:p.start,poc:p.poc,vah:p.vah,val:p.val,rows:p.rows}));
  delete summary.singlePrints;
  summary.hashes={curves:curveHashes,profiles:profileHashes,singlePrints:singlePrintHashes};
  summary.requests=openingRequests;
  await page.close();
  return summary;
}

(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const cases={};
  try{
    for(const symbol of symbols){
      for(const [template,timeframes] of templates){
        for(const timeframe of timeframes){
          cases[symbol+'|'+template+'|'+timeframe]=await capture(browser,symbol,template,timeframe,false);
        }
      }
    }
    for(const template of Object.keys(defaultTimeframes)){
      const timeframe=defaultTimeframes[template];
      cases['BTCUSDT|'+template+'|'+timeframe+'|snapshot']=await capture(browser,'BTCUSDT',template,timeframe,true);
    }
  }finally{
    await browser.close();
  }
  const payload={schema:'model-snapshot-v2',fixedTime:FIXED_TIME,cases};
  fs.writeFileSync(output,JSON.stringify(payload,null,2));
  console.log('wrote '+Object.keys(cases).length+' cases to '+output);
})().catch(err=>{console.error(err);process.exit(1);});
