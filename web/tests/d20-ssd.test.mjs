import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code=fs.readFileSync(new URL('../analysis/templates/ssd.js',import.meta.url),'utf8');
const context=vm.createContext({});
vm.runInContext(code,context);
const S=context.OrderFlowTemplates.ssd;

const levels=[
  {price:13.719,label:'13.719%',source:'manual'},
  {price:10.49,label:'10.490%',source:'manual'},
  {price:9.642,label:'9.642%',source:'manual'},
  {price:9.064,label:'9.064%',source:'manual'},
  {price:8.372,label:'8.372%',source:'manual'},
  {price:5.114,label:'5.114%',source:'manual'}
];
function payload(){
  return{
    source:'CoinGecko Demo API',generatedAt:'2026-10-10T00:00:00Z',
    calibration:{ratio:1.01,raw:9.118*1.01,tvValue:9.118,date:'2026-10-05'},
    points:[
      {date:'2026-10-04',raw:9.35,total:1000,missingCoins:0},
      {date:'2026-10-05',raw:9.118*1.01,total:1000,missingCoins:0},
      {date:'2026-10-06',raw:9.55,total:1000,missingCoins:0}
    ]
  };
}
const rules={ssd:{visiblePadPp:1.5,manualLevels:levels}};

test('D20 SSD maps UTC calendar dates without JST shift',()=>{
  const time=S.businessDay('2026-10-05');
  assert.equal(time.year,2026);
  assert.equal(time.month,10);
  assert.equal(time.day,5);
});

test('D20 SSD computes the calibrated line and nearest manual levels',()=>{
  const model=S.buildMacro({payload:payload(),rules});
  assert.equal(model.points.length,3);
  assert.ok(Math.abs(model.points[1].value-9.118)<1e-10);
  assert.ok(Math.abs(model.current-9.55/1.01)<1e-10);
  assert.equal(model.above.price,9.642);
  assert.equal(model.below.price,9.064);
  assert.ok(model.levels.every(x=>x.price>=model.min-1.5&&x.price<=model.max+1.5));
  assert.ok(!model.levels.some(x=>x.price===13.719));
});

test('D20 SSD preserves manual source in latest manifest',()=>{
  const values=S.manifestValues({model:S.buildMacro({payload:payload(),rules})});
  assert.equal(values.date,'2026-10-06');
  assert.equal(values.ratio,1.01);
  assert.equal(values.above.price,9.642);
  assert.equal(values.below.price,9.064);
  assert.equal(values.levelSource,'manual · KBeast 2026-10-05');
});

test('D20 SSD refuses to invent TV calibration from unavailable anchor',()=>{
  const p=payload();p.calibration.ratio=null;
  assert.throws(()=>S.buildMacro({payload:p,rules}),/calibration/);
});
