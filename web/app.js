(function (global) {
  'use strict';
  const C=global.OrderFlowCore, Live=global.OrderFlowLive.LiveFeed, R=global.OrderFlowRender;
  const CONFIG=global.ORDER_FLOW_SYMBOLS || {};
  const $=(id)=>document.getElementById(id);
  const query=new URLSearchParams(global.location.search);
  const maxTrades=Math.max(100000,Number(query.get('maxTrades'))||1000000);
  let feed=null, dirty=true, weeklyData=null;

  const fmt=(n,d=2)=>n==null||!Number.isFinite(n)?'n/a':Number(n).toLocaleString(undefined,{maximumFractionDigits:d});
  const jst=(ms)=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(ms));
  const setStatus=(s)=>{$('status').textContent=s;};

  function symbolConfig(){return CONFIG[$('symbol').value]||{base:'?',ladderBin:'1',defaultRow:'1',weeklyRows:['1']};}
  function setConnection(s){$('liveBadge').textContent=s;}
  function markDirty(){dirty=true;}

  function configureSymbolUi(){
    const cfg=symbolConfig();
    $('titleSymbol').textContent=$('symbol').value;
    $('cvdLabel').textContent='CVD / '+cfg.base;
    $('row').value=cfg.defaultRow;
    $('weeklyRow').innerHTML='';
    cfg.weeklyRows.forEach((v)=>{const o=document.createElement('option');o.value=v;o.textContent=v;$('weeklyRow').appendChild(o);});
    $('weeklyRow').value=cfg.weeklyRows[Math.floor(cfg.weeklyRows.length/2)]||cfg.weeklyRows[0];
    weeklyData=null;
    loadWeekly();
    markDirty();
  }

  function createFeed(){
    if(feed) feed.stop();
    feed=new Live({maxItems:maxTrades,onDirty:markDirty,onStatus:setStatus,onConnection:setConnection});
  }

  async function connect(){
    createFeed();
    await feed.start($('symbol').value);
    markDirty();
  }
  function disconnect(){if(feed)feed.stop();}

  function render(){
    dirty=false;
    const snap=feed?feed.snapshot():{trades:[],truncated:false,gaps:[]};
    const list=C.selectTrades(snap.trades,Number($('window').value));
    const row=Number($('row').value)||Number(symbolConfig().defaultRow);
    const interval=Number($('interval').value)||60000;
    if(!list.length){
      $('coverage').textContent='No captured flow.';
      $('last').textContent='n/a';$('cvd').textContent='n/a';$('poc').textContent='n/a';$('count').textContent='0';
      $('profile').innerHTML='<div class="notice">No data.</div>';
      $('footprint').innerHTML='<div class="notice">No footprint data.</div>';
      $('cvdChart').innerHTML='<div class="notice">No data.</div>';
      return;
    }
    const analysis=C.analyzeTrades(list,row,interval);
    const last=list[list.length-1];
    const cvdBuckets=C.bucketCvd(list,Math.max(1000,interval),5000);
    let cvd=0;for(const t of list)cvd+=t.m?-t.q:t.q;
    $('last').textContent=fmt(last.p,4);
    $('cvd').textContent=(cvd>=0?'+':'')+fmt(cvd,3);
    $('poc').textContent=fmt(analysis.poc,4);
    $('count').textContent=fmt(list.length,0);
    $('coverage').textContent=C.coverageText(list,Number($('window').value),jst,fmt,{truncated:snap.truncated,gaps:snap.gaps});
    $('profile').innerHTML=R.profileSvg(analysis.rows,row,'CAPTURED VP / sell + buy');
    $('footprint').innerHTML=R.footprintHtml(analysis.cols,row,last.p,jst);
    $('cvdChart').innerHTML=R.lineCvdSvg(cvdBuckets,'CVD / '+symbolConfig().base+' / OHLC buckets',jst);
  }

  async function fetchJson(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}
  async function loadWeekly(){
    const symbol=$('symbol').value;
    if(global.location.protocol==='file:'){
      $('weeklyStatus').textContent='Local file mode: live scripts work, but archived profile JSON requires a local HTTP server or GitHub Pages.';
      $('weekly').innerHTML='';return;
    }
    try{weeklyData=await fetchJson('profiles-'+symbol+'.json?ts='+Date.now());renderWeekly();}
    catch(e){$('weeklyStatus').textContent='Archive profile unavailable for '+symbol+': '+e.message;$('weekly').innerHTML='';}
  }
  function renderWeekly(){
    if(!weeklyData)return;
    const key=$('week').value,p=weeklyData.profiles&&weeklyData.profiles[key];
    if(!p){$('weeklyStatus').textContent='No archive profile for selected period.';$('weekly').innerHTML='';return;}
    const missing=(p.missingDays||[]);
    $('weeklyStatus').className='notice '+(p.complete?'ok':'warning');
    $('weeklyStatus').textContent=p.label+' | '+(p.complete?'COMPLETE':'INCOMPLETE')+' | days '+(p.days||[]).length+'/'+(p.expectedDays||[]).length+(missing.length?' | missing: '+missing.join(', '):'')+' | generated '+weeklyData.generatedAt;
    if(!p.rows||!p.rows.length){$('weekly').innerHTML='<div class="notice warning">No archived rows for this period.</div>';return;}
    const rowSize=$('weeklyRow').value;
    const rebinned=C.rebinLadderRows(p.rows,weeklyData.binSize,rowSize);
    $('weekly').innerHTML=R.profileSvg(rebinned,Number(rowSize),'WEEKLY VP / '+p.label,(idx)=>(idx+0.5)*Number(rowSize));
  }

  function init(){
    const select=$('symbol');select.innerHTML='';Object.keys(CONFIG).forEach((s)=>{const o=document.createElement('option');o.value=s;o.textContent=s;select.appendChild(o);});
    if(CONFIG.BTCUSDT)select.value='BTCUSDT';
    createFeed();configureSymbolUi();
    $('connect').onclick=connect;$('disconnect').onclick=disconnect;
    $('symbol').onchange=()=>{disconnect();configureSymbolUi();createFeed();};
    ['window','row','interval'].forEach((id)=>{$(id).onchange=markDirty;});
    $('weeklyReload').onclick=loadWeekly;$('week').onchange=renderWeekly;$('weeklyRow').onchange=renderWeekly;
    setInterval(()=>{if(dirty)render();},1000);
    render();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})(window);
