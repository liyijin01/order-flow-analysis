(function(global){
  'use strict';

  function planLatestUpdates(existing, latest, intervalSec) {
    const known=new Set((existing||[]).map(x=>x.time));
    const last=existing&&existing.length?existing[existing.length-1].time:null;
    const rows=(latest||[]).slice().sort((a,b)=>a.time-b.time);
    if(last!=null && rows.length && rows[rows.length-1].time > last + intervalSec){
      return {reloadRequired:true,updates:[],reason:'latest gap exceeds one interval'};
    }
    const updates=[];
    for(const bar of rows){
      if(last!=null && bar.time<last && !known.has(bar.time)) continue;
      updates.push({bar,historical:last!=null && bar.time<last});
    }
    return {reloadRequired:false,updates};
  }

  function applyLatestUpdates(args) {
    const plan=planLatestUpdates(args.existing,args.latest,args.intervalSec);
    if(plan.reloadRequired) return {...plan,updated:[],errors:[]};
    const updated=[],errors=[];
    for(const item of plan.updates){
      const bar=item.bar;
      try{
        args.candleSeries.update({time:bar.time,open:bar.open,high:bar.high,low:bar.low,close:bar.close},item.historical);
        args.volumeSeries.update({time:bar.time,value:bar.volume,color:bar.close>=bar.open?args.volumeUp:args.volumeDown},item.historical);
        updated.push({time:bar.time,historical:item.historical});
      }catch(error){
        errors.push({time:bar.time,error:String(error&&error.message||error)});
      }
    }
    return {...plan,updated,errors};
  }

  global.OrderFlowRealtime={planLatestUpdates,applyLatestUpdates};
})(typeof globalThis!=='undefined'?globalThis:window);
