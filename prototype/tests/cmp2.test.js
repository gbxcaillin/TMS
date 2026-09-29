const { chromium } = require('playwright');(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});const p=await b.newPage();
await p.goto('file://'+__dirname+'/live.html');
const r=await p.evaluate(()=>{const out=[];for(const bal of [150000,400000,900000])for(const [label,hold] of [['low-cost ETFs',[['VAS','Vanguard Australian Shares',.5],['VGS','Vanguard International Shares',.5]]],['managed funds',[['BTA0551AU','Fidelity Global Equities',.5],['FPS0004AU','Fiducian Growth Fund',.5]]]]){
  const a={id:'a1',p:'BT Panorama',prod:'Investments',kind:'Investment',bal,balKnown:true,fees:{},holdings:hold.map(([code,name,w])=>({code,name,value:bal*w})),insurance:[],asAt:'',src:''};
  const c={type:'Individual',profile:{risk:'Growth',accounts:[a],people:[]}};const f=feeCompare(c,['a1'],'Pearl Lite Growth');
  out.push(`Panorama Investments $${String(bal).padEnd(7)} ${label.padEnd(14)} now ${pct(f.cur.total/bal)}  DASH Wealth + Pearl Lite ${pct(f.rec.total/bal)}  ${f.saving>=0?'saves':'costs'} ${money(Math.abs(f.saving))}`)}return out});
console.log(r.join('\n'));await b.close()})();
