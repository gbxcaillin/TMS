const { chromium } = require('playwright');(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});const p=await b.newPage();p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('file://'+__dirname+'/live.html');
const r=await p.evaluate(()=>[
 {p:'Fiducian',prod:'Fiducian Superannuation Service',kind:'Super',bal:50000,fees:{},holdings:[{code:'FPS0004AU',name:'Fiducian Growth Fund',value:50000}]},
 {p:'Fiducian',prod:'Fiducian Superannuation Service',kind:'Super',bal:400000,fees:{paid:2900},holdings:[{code:'FPS0004AU',name:'Fiducian Growth Fund',value:250000},{code:'FPS0003AU',name:'Fiducian Balanced Fund',value:150000}]},
 {p:'Fiducian',prod:'Fiducian Investment Service',kind:'Investment',bal:50000,fees:{},holdings:[]},
 {p:'Fiducian',prod:'Fiducian Investment Service',kind:'Investment',bal:250000,fees:{},holdings:[{code:'FPS0004AU',name:'Fiducian Growth Fund',value:150000},{code:'CBA',name:'Commonwealth Bank',value:100000}]},
].map(a=>{const af=autoFees(a);const c=currentCost(a);return[a.prod,a.bal,Math.round(c.total),af.src.join(' | ')]}));
for(const x of r)console.log(JSON.stringify(x));await b.close()})();
