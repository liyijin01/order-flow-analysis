'use strict';
const {routeMarket}=require('./helpers.cjs');
const fixture=require('./ssd-fixture.json');
const pageUrl='http://127.0.0.1:8000/analysis.html';

async function setup(page,requests){
  await routeMarket(page,requests);
  await page.route('**/analysis/macro/ssd.json*',async route=>{
    await route.fulfill({
      status:200,contentType:'application/json',body:JSON.stringify(fixture)
    });
  });
}

const cases=[
  {
    ordinal:21,
    name:'ssd-dominance-and-manual-levels',
    run:async function(browser){
      const page=await browser.newPage({viewport:{width:1600,height:1000}});
      const requests=[];await setup(page,requests);
      await page.goto(pageUrl+'?tpl=ssd&tf=1d',{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>
        document.getElementById('status')?.textContent.startsWith('Loaded '),undefined,{timeout:60000});
      const output=await page.evaluate(()=>{
        const d=window.__analysisDebug,m=d.model,priceFormat=d.state.line.options().priceFormat;
        const visible=m.levels||[],all=m.manualLevels||[],key=visible.find(x=>Number(x.price)===9.064);
        const neighbor=window.OrderFlowTemplates.ssd.nearestLevels(all,m.current);
        return{
          template:d.template(),dataSource:d.state.rules.templates.ssd.dataSource,
          pointCount:m.points.length,visible:visible.length,
          lineCount:d.state.line.data().length,
          symbolButtonsHidden:getComputedStyle(document.querySelector('[data-symbol]').parentElement).display==='none',
          tableHidden:getComputedStyle(document.querySelector('.table-wrap')).display==='none',
          legendHidden:getComputedStyle(document.getElementById('analysisLegend')).display==='none',
          volumeHidden:!d.state.volume,
          timeButton:document.querySelector('[data-tf].active')?.dataset.tf,
          price:priceFormat.formatter(9.068),
          keyColor:key&&key.color,keyWidth:key&&key.width,
          inRange:visible.every(x=>x.price>=m.min-1.5&&x.price<=m.max+1.5),
          excluded:visible.some(x=>Number(x.price)===13.719),
          source:all.every(x=>x.source==='manual · KBeast 2026-10-05'),
          above:m.above&&m.above.price,expectedAbove:neighbor.above&&neighbor.above.price,
          below:m.below&&m.below.price,expectedBelow:neighbor.below&&neighbor.below.price,
          watermark:d.chartInfo().watermark,
          footer:document.querySelector('.capture-footer')?.textContent||'',
          countdown:d.chartInfo().countdown
        };
      });
      if(requests.length!==0)throw new Error('SSD default made Binance requests '+JSON.stringify(requests));
      if(output.template!=='ssd'||output.dataSource!=='macro/ssd')throw new Error('SSD route mismatch '+JSON.stringify(output));
      if(output.pointCount!==fixture.points.length||output.lineCount!==fixture.points.length)throw new Error('SSD missing line values');
      if(!output.symbolButtonsHidden||!output.tableHidden||!output.legendHidden||!output.volumeHidden)throw new Error('SSD chrome visibility');
      if(output.timeButton!=='1d'||output.price!=='9.068%')throw new Error('SSD timeframe or axis percent format');
      if(output.keyColor!=='#f5a623'||output.keyWidth!==1.5)throw new Error('9.064% orange width');
      if(!output.inRange||output.excluded)throw new Error('SSD manual lines outside visible data range');
      if(!output.source)throw new Error('SSD manual source metadata');
      if(output.above!==output.expectedAbove||output.below!==output.expectedBelow)throw new Error('SSD nearest levels');
      if(!output.watermark.includes('USDT.D+USDC.D+DAI.D')||!output.footer.includes('Data: CoinGecko'))throw new Error('SSD watermark or attribution');
      if(output.countdown)throw new Error('SSD countdown must be disabled');
      await page.close();
    }
  },
  {
    ordinal:22,
    name:'ssd-inverted-btc-overlay',
    run:async function(browser){
      const page=await browser.newPage({viewport:{width:1600,height:1000}});
      const requests=[];await setup(page,requests);
      await page.goto(pageUrl+'?tpl=ssd&tf=1d&overlay=btc',{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>
        document.getElementById('status')?.textContent.startsWith('Loaded '),undefined,{timeout:60000});
      const overlay=await page.evaluate(()=>{
        const d=window.__analysisDebug;
        return{
          count:d.binanceRequests(),
          overlay:!!d.state.btcOverlay,
          leftVisible:d.state.chart.priceScale('left').options().visible,
          inverted:d.state.chart.priceScale('left').options().invertScale,
          lineCount:d.state.btcOverlay&&d.state.btcOverlay.data().length,
        };
      });
      if(requests.length!==1||requests[0].interval!=='1d')throw new Error('SSD BTC overlay must request one 1d Kline '+JSON.stringify(requests));
      if(!overlay.overlay||!overlay.leftVisible||!overlay.inverted||overlay.lineCount<1)throw new Error('SSD inverted left-axis BTC overlay '+JSON.stringify(overlay));
      await page.close();
    }
  }
];
module.exports={cases};
