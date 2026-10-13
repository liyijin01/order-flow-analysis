'use strict';
const assert=require('node:assert/strict');
const symbols=['BTCUSDT','ETHUSDT','SOLUSDT'];
function fixture(symbol){
 const ts=['quarter','rvwap','weekly','monthly','mprofile','wprofile'];
 const levels=[{price:110,template:'quarter',name:'PQ VAH',kind:'line'},
 {price:110.2,template:'rvwap',name:'365D RVWAP',kind:'line'},
 {price:110.4,template:'mprofile',name:'Jan VAH',kind:'line'}];
 return{generatedAt:new Date().toISOString(),dataCutoffUtc:new Date().toISOString(),symbol,currentPrice:100,
 zones:[{low:110,high:110.4,levels,sources:3,strength:'strong'}],levels,
 states:[{name:'现价 vs 365D RVWAP',value:100,reference:110.2,state:'below',distancePct:10.2,template:'rvwap'},
 {name:'稳定币占比 vs 9.064%',value:9.12,reference:9.064,state:'above',distancePct:.6,template:'ssd'}],
 pngs:ts.map(t=>symbol+'-'+t+'.png').concat('SSD-1d.png')};
}
module.exports={cases:[{name:'D21 brief static and mobile',ordinal:100,async run(browser){
 const page=await browser.newPage({viewport:{width:1100,height:900}});
 const requests=[];page.on('request',r=>{if(/binance\\.com|binance\\.vision/.test(r.url()))requests.push(r.url());});
 await page.route(/\/analysis\/brief\/([A-Z]+)\.json(?:\?.*)?$/,route=>{
  const match=route.request().url().match(/brief\/([A-Z]+)\.json/);
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture(match[1]))});
 });
 await page.goto('http://127.0.0.1:8000/brief.html',{waitUntil:'domcontentloaded'});
 for(const symbol of symbols){
  await page.click('button[data-symbol="'+symbol+'"]');
  await page.waitForFunction(s=>document.getElementById('headline').textContent.includes(s),symbol);
  assert.equal(await page.locator('#pngs article').count(),7);
  assert.equal(await page.locator('#ladder .strong').count(),1);
  const rows=await page.locator('#ladder .row').allTextContents();
  assert.ok(rows.findIndex(s=>s.includes('110'))<rows.findIndex(s=>s.includes('现价')));
  const href=await page.locator('#ladder .strong a').first().getAttribute('href');
  assert.ok(href.includes('tpl=quarter')&&href.includes('symbol='+symbol));
 }
 await page.setViewportSize({width:375,height:820});
 await page.waitForTimeout(150);
 const width=await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);
 assert.ok(width[0]<=width[1],'mobile overflow '+width);
 assert.deepEqual(requests,[]);
 await page.close();
}}]};
