const { chromium } = require('playwright');(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});const p=await b.newPage();p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('file://'+__dirname+'/live.html');
const r=await p.evaluate(()=>{const accs=[
 {p:'BT Panorama',prod:'Super',kind:'Super',bal:400000,fees:{},holdings:[{code:'VAS',name:'Vanguard Australian Shares Index ETF',value:150000},{code:'BTA0551AU',name:'Fidelity Global Equities',value:150000},{code:'XYZ',name:'Unknown',value:100000}]},
 {p:'Fiducian',prod:'Fiducian Superannuation Service',kind:'Super',bal:300000,fees:{paid:2900},holdings:[{code:'FPS0004AU',name:'Fiducian Growth Fund',value:200000},{code:'FPS0003AU',name:'Fiducian Balanced Fund',value:100000}]},
 {p:'Fiducian',prod:'Fiducian Portfolio Service (IDPS)',kind:'Investment',bal:120000,fees:{adminPct:.0055},holdings:[{code:null,name:'Fiducian Growth Fund',value:120000}]},
 {p:'AustralianSuper',prod:'Balanced',kind:'Super',bal:286450,fees:{},holdings:[]},
 {p:'BT Panorama',prod:'Investments',kind:'Investment',bal:90000,fees:{},holdings:[]}];
 return accs.map(a=>{const af=autoFees(a);const c=currentCost(a);return[a.p+' '+a.prod,af.product,af.src,Math.round(c.total),af.fees]})});
for(const x of r)console.log(JSON.stringify(x));await b.close()})();
