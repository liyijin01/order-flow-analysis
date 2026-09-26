(function(global){
  'use strict';
  global.OrderFlowChartPresets={
    p1:{id:'p1',label:'P1 季度价值区',symbol:'ETHUSDT',market:'um',interval:'1h',fixture:'p1'},
    p2:{id:'p2',label:'P2 月度 TPO',symbol:'SOLUSDT',market:'um',interval:'30m',fixture:'p2'},
    p3:{id:'p3',label:'P3 周度 TPO',symbol:'BTCUSDT',market:'um',interval:'30m',fixture:'p3'},
    p4:{id:'p4',label:'P4 区间框',symbol:'SOLUSDT',market:'um',interval:'2h',fixture:'p4'},
    p5:{id:'p5',label:'P5 衍生品面板',symbol:'BTCUSDT',market:'um',interval:'4h',fixture:'p5'}
  };
})(typeof globalThis!=='undefined'?globalThis:window);
