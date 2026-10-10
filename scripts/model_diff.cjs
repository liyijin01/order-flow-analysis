const fs=require('fs');

const basePath=process.argv[2],headPath=process.argv[3],reportPath=process.argv[4];
if(!basePath||!headPath||!reportPath){
  console.error('usage: node scripts/model_diff.cjs <base.json> <head.json> <report.md>');
  process.exit(2);
}
const base=JSON.parse(fs.readFileSync(basePath,'utf8')),head=JSON.parse(fs.readFileSync(headPath,'utf8'));
const diffs=[],permitted=[];

function relEqual(a,b){
  if(Object.is(a,b))return true;
  if(!Number.isFinite(a)||!Number.isFinite(b))return false;
  return Math.abs(a-b)/Math.max(1,Math.abs(a),Math.abs(b))<=1e-9;
}
function compare(a,b,path){
  if(path.endsWith('.calcLastClosedUtc')){
    if(a!==b)permitted.push({path,base:a,head:b});
    return;
  }
  if(path.endsWith('.requests'))return;
  if(typeof a==='number'||typeof b==='number'){
    if(typeof a!=='number'||typeof b!=='number'||!relEqual(a,b))diffs.push({path,base:a,head:b});
    return;
  }
  if(a===null||b===null||typeof a!=='object'||typeof b!=='object'){
    if(a!==b)diffs.push({path,base:a,head:b});
    return;
  }
  if(Array.isArray(a)||Array.isArray(b)){
    if(!Array.isArray(a)||!Array.isArray(b)){diffs.push({path,base:a,head:b});return;}
    if(a.length!==b.length)diffs.push({path:path+'.length',base:a.length,head:b.length});
    const n=Math.min(a.length,b.length);for(let i=0;i<n;i++)compare(a[i],b[i],path+'['+i+']');
    return;
  }
  const keys=new Set([...Object.keys(a),...Object.keys(b)]);
  for(const key of [...keys].sort()){
    if(key==='requests'&&path.startsWith('cases.'))continue;
    if(!(key in a)||!(key in b)){diffs.push({path:path+'.'+key,base:a[key],head:b[key]});continue;}
    compare(a[key],b[key],path+'.'+key);
  }
}

function requestSummary(row){
  const requests=(row&&row.requests)||[],limits={};
  for(const req of requests){
    const interval=String(req.interval||'?');
    limits[interval]=(limits[interval]||0)+(Number(req.limit)||0);
  }
  return{count:requests.length,limits};
}
function formatLimits(limits){
  return Object.keys(limits).sort().map(k=>k+':'+limits[k]).join(', ')||'—';
}

const baseCases=base.cases||{},headCases=head.cases||{};
const caseKeys=new Set([...Object.keys(baseCases),...Object.keys(headCases)]);
const legacyKeys=[...caseKeys].filter(key=>!key.includes('|ssd|'));
for(const key of legacyKeys.sort()){
  if(!(key in baseCases)||!(key in headCases)){diffs.push({path:'cases.'+key,base:baseCases[key],head:headCases[key]});continue;}
  compare(baseCases[key],headCases[key],'cases.'+key);
}
let report='# Model diff\n\n';
if(!diffs.length)report+='0 differences across '+legacyKeys.length+' cases\n';
else{
  report+=diffs.length+' differences across '+legacyKeys.length+' cases\n\n';
  report+='| Field | Base | Head |\n|---|---|---|\n';
  for(const d of diffs.slice(0,500)){
    const esc=v=>String(JSON.stringify(v)).replace(/\|/g,'\\|').replace(/\n/g,' ');
    report+='| `'+d.path+'` | `'+esc(d.base)+'` | `'+esc(d.head)+'` |\n';
  }
}
const ssdKeys=[...caseKeys].filter(key=>key.includes('|ssd|'));
report+='\n## New SSD template (reported separately)\n\n';
for(const key of ssdKeys){
  const item=headCases[key];
  report+='| '+key+' | '+(item?JSON.stringify(item):'missing')+' |\n';
}
report+='\n## Allowed calcLastClosedUtc changes\n\n';
if(permitted.length){
  report+='| Case field | Base | Head |\n|---|---|---|\n';
  for(const p of permitted)report+='| `'+p.path+'` | '+String(p.base)+' | '+String(p.head)+' |\n';
}else report+='No changes.\n';
report+='\n## Request summary\n\n';
report+='| Case | Base requests | Head requests | Base limits | Head limits |\n|---|---:|---:|---|---|\n';
for(const key of legacyKeys.sort()){
  const b=requestSummary(baseCases[key]),h=requestSummary(headCases[key]);
  report+='| `'+key+'` | '+b.count+' | '+h.count+' | '+formatLimits(b.limits)+' | '+formatLimits(h.limits)+' |\n';
}
const maxRequests={
  'quarter|1h':4,'quarter|4h':5,'rvwap|4h':2,'weekly|30m':3,
  'monthly|1M':2,'mprofile|1d':2,'wprofile|1d':2
};
const requestViolations=[];
for(const [key,item] of Object.entries(headCases)){
  if(key.endsWith('|snapshot')||key.includes('|ssd|'))continue;
  const [,template,timeframe]=key.split('|'),limit=maxRequests[template+'|'+timeframe];
  const count=requestSummary(item).count;
  if(limit!=null&&count>limit)requestViolations.push(key+': '+count+' > '+limit);
  if(template==='combined'&&count!==requestSummary(baseCases[key]).count){
    requestViolations.push(key+': combined request count changed');
  }
}
report+='\n## Request limits\n\n'+(requestViolations.length?requestViolations.join('\n'):'All templates within limits')+'\n';
fs.writeFileSync(reportPath,report);
console.log(report.trim());
if((diffs.length||requestViolations.length)&&process.env.MODEL_DIFF_STRICT==='1')process.exit(1);
