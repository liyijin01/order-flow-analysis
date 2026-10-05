const {chromium}=require('playwright-core');
const fs=require('fs');
const {
  routeMarket,routeKeyLevels,routeProfiles,routeTpo
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
const symbols=['BTCUSDT','ETHUSDT','SOLUSDT'];

function compactPoint(p){
  if(!p)return null;
  const out={};
  for(const key of ['time','value','vwap','upper','lower'])if(p[key]!=null)out[key]=Number(p[key]);
  return out;
}

(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const cases={};
  try{
    for(const symbol of symbols){
      for(const [template,timeframes] of templates){
        for(const timeframe of timeframes){
          const page=await browser.newPage({viewport:{width:1600,height:1000}});
          await page.clock.setFixedTime(FIXED_TIME);
          const requests=[];
          await routeMarket(page,requests);
          await routeKeyLevels(page,'fixture');
          await routeProfiles(page,FIXED_TIME);
          await routeTpo(page,FIXED_TIME);
          const url=pageUrl+'?symbol='+encodeURIComponent(symbol)+'&tpl='+encodeURIComponent(template)+'&tf='+encodeURIComponent(timeframe);
          await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
          await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),undefined,{timeout:60000});
          await page.waitForTimeout(100);
          await page.evaluate(()=>window.__analysisDebug.refresh(true));
          await page.waitForFunction(()=>document.getElementById('status')?.textContent.startsWith('Loaded '),undefined,{timeout:60000});
          await page.waitForTimeout(50);
          const summary=await page.evaluate(()=>{
            const d=window.__analysisDebug,m=d.model,primitive=d.state.primitive&&d.state.primitive.model||{};
            const pick=(obj,keys)=>{
              const out={};for(const key of keys)if(obj&&obj[key]!=null)out[key]=obj[key];return out;
            };
            const curves=(m.curves||[]).map(c=>({
              id:c.id,points:(c.points||[]).length,first:(c.points||[])[0]||null,last:(c.points||[]).length?(c.points||[])[(c.points||[]).length-1]:null
            }));
            const profiles=(m.profiles||[]).map(p=>({
              start:Number(p.start),poc:Number(p.poc),vah:Number(p.vah),val:Number(p.val),rows:Array.isArray(p.rows)?p.rows.length:0
            }));
            return{
              display:{count:m.display.length,first:m.display.length?Number(m.display[0].time):null,last:m.display.length?Number(m.display[m.display.length-1].time):null},
              levels:(m.levels||[]).map(x=>pick(x,['id','kind','price','from','to','style','color','label','axisLabel','naked','touchedThisPeriod'])),
              regions:(m.regions||[]).map(x=>pick(x,['id','scope','type','bottom','top','from','to'])),
              curves,
              profiles,
              infoValues:m.infoValues||null,
              infoLines:[document.getElementById('chartInfo1')?.textContent||'',document.getElementById('chartInfo2')?.textContent||''],
              axisLabels:d.axisLabels().filter(x=>x.visible).map(x=>x.id),
              defaultRange:d.state.defaultViewRange?{from:Number(d.state.defaultViewRange.from),to:Number(d.state.defaultViewRange.to)}:null,
              autoscale:{min:Number(primitive.autoscaleMin),max:Number(primitive.autoscaleMax)}
            };
          });
          summary.curves=summary.curves.map(c=>({
            ...c,first:compactPoint(c.first),last:compactPoint(c.last)
          }));
          summary.requests=requests.map(x=>({interval:x.interval,limit:x.limit}));
          cases[symbol+'|'+template+'|'+timeframe]=summary;
          await page.close();
        }
      }
    }
  }finally{
    await browser.close();
  }
  const payload={schema:'model-snapshot-v1',fixedTime:FIXED_TIME,cases};
  fs.writeFileSync(output,JSON.stringify(payload,null,2));
  console.log('wrote '+Object.keys(cases).length+' cases to '+output);
})().catch(err=>{console.error(err);process.exit(1);});
