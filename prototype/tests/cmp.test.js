const { chromium } = require('playwright');(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});const p=await b.newPage();
await p.goto('file://'+__dirname+'/live.html');
const r=await p.evaluate(()=>{const out=[];for(const bal of [150000,400000,900000])for(const [p,prod,kind,hold] of [
 ['Fiducian','Fiducian Superannuation Service','Super',[['FPS0004AU','Fiducian Growth Fund',.6],['FPS0003AU','Fiducian Balanced Fund',.4]]],
 ['Fiducian','Fiducian Investment Service','Investment',[['FPS0004AU','Fiducian Growth Fund',.6],['FPS0003AU','Fiducian Balanced Fund',.4]]],
 ['BT Panorama','Super','Super',[['VAS','Vanguard Australian Shares',.5],['BTA0551AU','Fidelity Global Equities',.5]]]]){
  const a={id:'a1',p,prod,kind,bal,balKnown:true,fees:{},holdings:hold.map(([code,name,w])=>({code,name,value:bal*w})),insurance:[],asAt:'',src:''};
  const c={type:'Individual',profile:{risk:'Growth',accounts:[a],people:[]}};
  for(const port of ['Pearl Lite Growth','Pearl X Growth']){const f=feeCompare(c,['a1'],port);out.push(`${prod.padEnd(32)} $${String(bal).padEnd(7)} ${port.padEnd(17)} now ${pct(f.cur.total/bal)}  DASH ${pct(f.rec.total/bal)}  ${f.saving>=0?'saves':'costs'} ${money(Math.abs(f.saving))}`)}}return out});
console.log(r.join('\n'));await b.close()})();
