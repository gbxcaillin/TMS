const { chromium } = require('playwright');
const fs=require('fs');const html=fs.readFileSync(require('path').join(__dirname,'..','brightday-portal.html'),'utf8');
fs.writeFileSync(__dirname+'/doc.html','<!doctype html><html><head><meta charset="utf-8"></head><body>'+html+'</body></html>');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const p=await b.newPage({viewport:{width:1360,height:900}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.addInitScript(()=>{window.__calls=0;window.claude={use:async n=>{if(n!=='sample')return null;const f=async()=>({text:''});f.json=async()=>{window.__calls++;await new Promise(r=>setTimeout(r,500));return{kind:'answer',title:'Mock',text:'Mock answer from Brightly.',clients:['wilson']}};return f}}});
  await p.goto('file://'+__dirname+'/doc.html');await p.click('#login .btn-primary');await p.waitForTimeout(300);
  const names=()=>p.$$eval('main tbody tr td:first-child b',e=>e.map(x=>x.textContent));
  const cases=['show me all the ART clients with 200k balance on ongoing fees','ART 200k ongoing','sell rated','holds CSL','couples over 1m','super under 50k','review within 14 days','high growth','smsf','draft profiles','clients under 1m','property over 500k'];
  for(const q of cases){await p.fill('#q',q);await p.waitForTimeout(80);if(q==='ART 200k ongoing')await p.screenshot({path:'s-drop.png'});await p.press('#q','Enter');await p.waitForTimeout(200);
    console.log(q.padEnd(62),'->',(await names()).join(' | '))}
  await p.fill('#q','okafor');await p.press('#q','Enter');await p.waitForTimeout(200);console.log('okafor ->',await p.$eval('h1',e=>e.textContent));
  await p.fill('#q','what should I do this week');await p.waitForTimeout(80);console.log('dropdown ->',await p.$eval('#sdrop',e=>e.innerText.split('\n')[0]));
  await p.screenshot({path:'s-none.png'});
  console.log('AI calls from search:',await p.evaluate(()=>window.__calls));
  await p.click('#sdrop .sopt.ask');await p.waitForTimeout(900);console.log('ask via dropdown ->',await p.$eval('.answer',e=>e.innerText.trim()),'calls',await p.evaluate(()=>window.__calls));
  await p.click('[data-go="clients"]');await p.click('#askbtn');await p.waitForTimeout(200);console.log('askbtn ->',await p.$eval('h1',e=>e.textContent));
  await p.screenshot({path:'s-ask.png'});
  console.log('errors',errs);await b.close()})();
