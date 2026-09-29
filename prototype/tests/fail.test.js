const { chromium } = require('playwright');
const fs=require('fs');const html=fs.readFileSync(require('path').join(__dirname,'..','brightday-portal.html'),'utf8');
fs.writeFileSync(__dirname+'/doc.html','<!doctype html><html><head><meta charset="utf-8"></head><body>'+html+'</body></html>');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const p=await b.newPage({viewport:{width:1360,height:900}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.addInitScript(()=>{window.__qs=[];window.claude={use:async n=>{if(n!=='sample')return null;const f=async()=>({text:''});f.json=async(inp)=>{window.__qs.push(inp.split('QUESTION: ')[1]);await new Promise(r=>setTimeout(r,400));return{kind:'answer',title:'Brightly',text:'Mock answer.',clients:[]}};return f}}});
  await p.goto('file://'+__dirname+'/doc.html');await p.click('#login .btn-primary');await p.waitForTimeout(300);
  const calls=()=>p.evaluate(()=>window.__qs.slice());
  for(const q of ['ART 200k ongoing','sell rated','okafor','super under 50k']){await p.fill('#q',q);await p.press('#q','Enter');await p.waitForTimeout(200)}
  console.log('normal searches -> Brightly calls:',(await calls()).length);
  // 1 nothing recognised
  await p.fill('#q','what should I do this week');await p.waitForTimeout(80);await p.screenshot({path:'f-drop.png'});
  await p.press('#q','Enter');await p.waitForTimeout(700);console.log('1 nothing recognised ->',await p.$eval('h1',e=>e.textContent),'|',await p.$eval('.answer',e=>e.innerText.trim()),'| asked:',(await calls()).slice(-1));
  // 2 partly recognised
  await p.fill('#q',"ART clients over 200k who haven't had a review since March");await p.waitForTimeout(80);
  console.log('2 dropdown ->',(await p.$eval('#sdrop .sopt',e=>e.innerText)).replace(/\n/g,' / '));
  await p.screenshot({path:'f-neg.png'});await p.press('#q','Enter');await p.waitForTimeout(700);console.log('2 negation Enter asked:',(await calls()).slice(-1),await p.$eval('h1',e=>e.textContent));
  await p.fill('#q',"ART clients over 200k with a pending estate question");await p.press('#q','Enter');await p.waitForTimeout(200);
  console.log('2 clients ->',await p.$$eval('main tbody tr td:first-child b',e=>e.map(x=>x.textContent)),'|',await p.$eval('.brightly-offer',e=>e.innerText));
  await p.screenshot({path:'f-partial.png'});
  await p.click('.brightly-offer [data-askfull]');await p.waitForTimeout(700);console.log('2 full question asked:',(await calls()).slice(-1));
  // 3 zero matches
  await p.fill('#q','ART under 1k');await p.press('#q','Enter');await p.waitForTimeout(200);
  console.log('3 zero ->',await p.$eval('main tbody .empty',e=>e.innerText.replace(/\n/g,' / ')));
  await p.click('tbody [data-askfull]');await p.waitForTimeout(700);console.log('3 asked:',(await calls()).slice(-1));
  console.log('errors',errs);await b.close()})();
