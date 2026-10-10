'use strict';
const fs=require('fs');
const path=require('path');
const {chromium}=require('playwright-core');

const suites=['quarter','combined','common','rvwap','weekly','monthly','mprofile','wprofile','ssd'];
const requested=process.argv[2];
if(requested&&!suites.includes(requested)){
  console.error('Unknown smoke suite: '+requested+'. Available: '+suites.join(', '));
  process.exit(2);
}

const all=suites.flatMap(name=>{
  const suite=require('./'+name+'.cjs');
  return suite.cases.map(test=>({...test,file:name+'.cjs'}));
}).sort((a,b)=>a.ordinal-b.ordinal);
const selected=requested?all.filter(t=>t.file===requested+'.cjs'):all;
const countAssertions=suites.reduce((total,name)=>{
  const file=fs.readFileSync(path.join(__dirname,name+'.cjs'),'utf8');
  return total+(file.match(/throw new Error\(/g)||[]).length;
},0);
const legacyCount=suites.filter(name=>name!=='ssd').reduce((total,name)=>{
  const file=fs.readFileSync(path.join(__dirname,name+'.cjs'),'utf8');
  return total+(file.match(/throw new Error\(/g)||[]).length;
},0);
if(legacyCount!==125||all.length!==23||countAssertions<135){
  throw new Error('Smoke assertion inventory changed: '+countAssertions+' total, '+
    legacyCount+' legacy, '+all.length+' cases; expected >=135, 125 and 23');
}

(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  let passed=0;
  try{
    for(const test of selected){
      try{
        await test.run(browser);
        passed++;
        console.log('PASS '+test.file+' :: '+test.name);
      }catch(error){
        error.message='FAIL '+test.file+' :: '+test.name+' :: '+error.message;
        throw error;
      }
    }
  }finally{await browser.close();}
  console.log('Smoke passed: '+passed+' cases, '+countAssertions+' retained assertions'+(requested?' (suite '+requested+')':''));
})().catch(error=>{console.error(error);process.exitCode=1;});
