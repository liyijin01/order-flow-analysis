'use strict';
const {routeMarket,routeKeyLevels,routeProfiles,routeTpo}=require('./helpers.cjs');
const pageUrl='http://127.0.0.1:8000/analysis.html';

async function setup(page){
  await routeMarket(page,[]);
  await routeKeyLevels(page,'fixture');
  await routeProfiles(page,'2026-09-27T12:00:00Z');
  await routeTpo(page,'2026-09-27T12:00:00Z');
}
function precomputedPath(url){
  const pathname=new URL(url).pathname;
  if(/\/analysis\/levels\/[A-Z]+\.json$/.test(pathname))return'levels';
  if(/\/analysis\/tpo\/[A-Z]+\.json$/.test(pathname))return'tpo';
  if(/\/profiles-[A-Z]+\.json$/.test(pathname))return'profile';
  if(/\/analysis\/macro\/ssd\.json$/.test(pathname))return'macro/ssd';
  return null;
}
async function waitLoaded(page,template){
  await page.waitForFunction(expected=>{
    return window.__analysisDebug?.template()===expected&&
      document.getElementById('status')?.textContent.startsWith('Loaded ');
  },template,{timeout:60000});
}
const cases=[{
  ordinal:23,
  name:'versioned-precomputed-by-template-and-timing',
  run:async function(browser){
    const configs=[
      ['quarter','1h',['levels']],
      ['rvwap','4h',['levels']],
      ['weekly','30m',[]],
      ['monthly','1M',[]],
      ['mprofile','1d',['tpo']],
      ['wprofile','1d',['tpo']],
      ['combined','4h',['levels','profile']],
      ['ssd','1d',['macro/ssd']]
    ];
    for(const [template,timeframe,wanted] of configs){
      const page=await browser.newPage({viewport:{width:1600,height:1000}});
      const assets=[],thirdParty=[];
      page.on('request',r=>{
        const kind=precomputedPath(r.url());
        if(kind)assets.push(kind);
        if(r.url().includes('cdn.jsdelivr.net'))thirdParty.push(r.url());
      });
      await setup(page);
      await page.goto(pageUrl+'?tpl='+template+'&tf='+timeframe+'&symbol=BTCUSDT',{
        waitUntil:'domcontentloaded',timeout:60000
      });
      await waitLoaded(page,template);
      const got=[...new Set(assets)].sort(),want=wanted.slice().sort();
      if(JSON.stringify(got)!==JSON.stringify(want)){
        throw new Error(template+' precomputed '+JSON.stringify(got)+' expected '+JSON.stringify(want));
      }
      if(thirdParty.length)throw new Error(template+' still loads jsdelivr');
      const timing=await page.evaluate(()=>({
        timing:window.__analysisDebug?.timing,
        status:document.getElementById('status').textContent
      }));
      if(!timing.status.includes('加载 ')||
        !timing.timing||!['klinesMs','precomputedMs','renderMs','totalMs']
          .every(key=>Number.isFinite(timing.timing[key]))){
        throw new Error(template+' timing missing '+JSON.stringify(timing));
      }
      if(template==='quarter'){
        const before=assets.length;
        await page.click('[data-tpl="combined"]');
        await waitLoaded(page,'combined');
        await page.click('[data-tpl="quarter"]');
        await waitLoaded(page,'quarter');
        if(assets.filter(x=>x==='levels').length!==1){
          throw new Error('Same-session cached levels fetched more than once: '+
            JSON.stringify(assets.slice(before)));
        }
      }
      await page.close();
    }
  }
}];
module.exports={cases};
