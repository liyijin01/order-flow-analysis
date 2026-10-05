const fs=require('fs');

const basePath=process.argv[2],headPath=process.argv[3],reportPath=process.argv[4];
if(!basePath||!headPath||!reportPath){
  console.error('usage: node scripts/model_diff.cjs <base.json> <head.json> <report.md>');
  process.exit(2);
}
const base=JSON.parse(fs.readFileSync(basePath,'utf8')),head=JSON.parse(fs.readFileSync(headPath,'utf8'));
const diffs=[];

function relEqual(a,b){
  if(Object.is(a,b))return true;
  if(!Number.isFinite(a)||!Number.isFinite(b))return false;
  return Math.abs(a-b)/Math.max(1,Math.abs(a),Math.abs(b))<=1e-9;
}
function compare(a,b,path){
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

const baseCases=base.cases||{},headCases=head.cases||{};
const caseKeys=new Set([...Object.keys(baseCases),...Object.keys(headCases)]);
for(const key of [...caseKeys].sort()){
  if(!(key in baseCases)||!(key in headCases)){diffs.push({path:'cases.'+key,base:baseCases[key],head:headCases[key]});continue;}
  compare(baseCases[key],headCases[key],'cases.'+key);
}
let report='# Model diff\n\n';
if(!diffs.length)report+='0 differences across '+Object.keys(headCases).length+' cases\n';
else{
  report+=diffs.length+' differences across '+Object.keys(headCases).length+' cases\n\n';
  report+='| Field | Base | Head |\n|---|---|---|\n';
  for(const d of diffs.slice(0,500)){
    const esc=v=>String(JSON.stringify(v)).replace(/\|/g,'\\|').replace(/\n/g,' ');
    report+='| `'+d.path+'` | `'+esc(d.base)+'` | `'+esc(d.head)+'` |\n';
  }
}
fs.writeFileSync(reportPath,report);
console.log(report.trim());
if(diffs.length&&process.env.MODEL_DIFF_STRICT==='1')process.exit(1);
