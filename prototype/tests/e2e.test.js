const { chromium } = require('playwright');const fs=require('fs');const {spawn}=require('child_process');
const html=fs.readFileSync(require('path').join(__dirname,'..','brightly-live.html'),'utf8');
fs.writeFileSync(__dirname+'/live.html','<!doctype html><html><head><meta charset="utf-8"></head><body>'+html+'</body></html>');
const log=(...a)=>{const l=a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');console.log(l);fs.appendFileSync(__dirname+'/e2e.log',l+'\n')};
fs.writeFileSync(__dirname+'/e2e.log','');
let n=0;
function realClaude(prompt){return new Promise((res,rej)=>{const id=++n;fs.writeFileSync(__dirname+`/call${id}.txt`,prompt);const t0=Date.now();
  const c=spawn('claude',['-p','--output-format','text','--tools',''],{stdio:['pipe','pipe','pipe']});let out='',err='';c.stdout.on('data',d=>out+=d);c.stderr.on('data',d=>err+=d);
  c.on('close',code=>{fs.writeFileSync(__dirname+`/answer${id}.txt`,out);log(`  [claude call ${id}: ${prompt.slice(0,60).replace(/\n/g,' ')}… ${Math.round((Date.now()-t0)/1000)}s, exit ${code}]`);code?rej(new Error(err.slice(-300))):res(out)});
  c.stdin.end('Reply with only the JSON value, no other text.\n\n'+prompt)})}
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',proxy:{server:process.env.HTTPS_PROXY},args:['--ignore-certificate-errors']});
  const ctx=await b.newContext({viewport:{width:1360,height:900},acceptDownloads:true});const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.exposeFunction('realClaude',realClaude);
  await p.addInitScript(()=>{window.claude={use:async n=>{if(n!=='sample')return null;const f=async()=>({text:''});
    f.json=async(input,opts={})=>{const t=typeof input==='string'?input:input.map(x=>x.content).join('\n\n');const out=await window.realClaude(t);if(opts.signal&&opts.signal.aborted)throw{code:'cancelled'};
      const s=out.indexOf('{')>=0&&(out.indexOf('[')<0||out.indexOf('{')<out.indexOf('['))?out.slice(out.indexOf('{'),out.lastIndexOf('}')+1):out.slice(out.indexOf('['),out.lastIndexOf(']')+1);
      try{return JSON.parse(s)}catch{throw{code:'invalid_json',text:out}}};f.limits=async()=>({maxPromptBytes:262144});return f}}});
  await p.goto('file://'+__dirname+'/live.html');await p.fill('#le','Test Adviser');await p.click('#login .btn-primary');await p.waitForTimeout(300);
  // practice settings
  await p.click('[data-go="settings"]');for(const [k,v] of Object.entries({arNo:'000000',car:'000000',licensee:'Test Licensee Pty Ltd',afsl:'000000',phone:'03 0000 0000',email:'test@example.test'}))await p.fill('#ps-'+k,v);await p.click('#psf button[type=submit]');
  // import
  await p.click('[data-go="clients"]');await p.click('#addc');
  const files=fs.readdirSync(__dirname+'/testdocs').filter(f=>!f.endsWith('.js')).map(f=>__dirname+'/testdocs/'+f);await p.setInputFiles('#impfile',files);
  await p.waitForFunction(()=>!IMP.busy&&IMP.order.length>=5,null,{timeout:60000});
  log('STEP sort');await p.click('#impsort');await p.waitForFunction(()=>!IMP.busy,null,{timeout:600000});
  log('assign',await p.evaluate(()=>impDocs().map(d=>d.name+' -> '+(IMP.assign[d.id]||'-'))));await p.screenshot({path:'E-sorted.png',fullPage:true});
  log('STEP build');await p.click('#impbuild');await p.waitForFunction(()=>IMP.stage==='done'||UI.view==='client',null,{timeout:900000});await p.waitForTimeout(300);
  log('log',await p.evaluate(()=>IMP.log));
  const cl=await p.evaluate(()=>S.clients.map(c=>({id:c.id,name:c.name,type:c.type,risk:c.profile.risk,fee:c.fee,accounts:c.profile.accounts.map(a=>[a.p,a.prod,a.kind,a.owner,a.bal,a.src,a.fees,a.ins]),parcels:c.profile.parcels.length,realised:c.profile.realised,goals:c.profile.goals,flags:c.profile.flags,gaps:c.profile.gaps,request:c.profile.request})));
  log('CLIENTS',JSON.stringify(cl,null,1));
  const tan=cl.find(c=>/tan/i.test(c.name)),pat=cl.find(c=>/patel/i.test(c.name));
  await p.evaluate(id=>go('client',{id,tab:'profile'}),tan.id);await p.screenshot({path:'E-profile.png',fullPage:true});
  // confirm Tan profile via run page
  const prun=await p.evaluate(id=>S.runs.find(r=>r.client===id&&r.tool==='client-profile').id,tan.id);await p.evaluate(id=>go('run',{id}),prun);await p.click('[data-ok="0"]');await p.waitForTimeout(200);
  log('tan profile status',await p.evaluate(id=>client(id).profile.status,tan.id));
  // fee comparison
  await p.evaluate(id=>go('tool',{id:'fee-comparison',client:id}),tan.id);await p.waitForTimeout(200);log('preview',await p.$eval('#fpreview',e=>e.innerText));await p.screenshot({path:'E-feeform.png',fullPage:true});
  await p.click('#rf button[type=submit]');await p.waitForFunction(()=>S.runs[0].status!=='running',null,{timeout:60000});log('fee summary',await p.evaluate(()=>S.runs[0].summary));await p.screenshot({path:'E-fee.png',fullPage:true});
  // SOA
  log('STEP soa');await p.evaluate(id=>go('tool',{id:'soa',client:id}),tan.id);await p.waitForTimeout(200);await p.click('#rf button[type=submit]');
  await p.waitForFunction(()=>S.runs[0].status!=='running',null,{timeout:600000});await p.waitForTimeout(300);
  log('soa status',await p.evaluate(()=>[S.runs[0].status,S.runs[0].summary,S.runs[0].checks]));await p.screenshot({path:'E-soa.png',fullPage:true});
  if(await p.$('[data-pv="0"]')){await p.click('[data-pv="0"]');await p.waitForTimeout(300);await p.screenshot({path:'E-soa-preview.png',fullPage:true});
    const [dl]=await Promise.all([p.waitForEvent('download'),p.click('.doc [data-dl="0"]')]);await dl.saveAs(__dirname+'/SOA-test.docx');log('downloaded',dl.suggestedFilename())}
  // ROA for Patel (no change), tax, annual review
  log('STEP roa');await p.evaluate(id=>go('tool',{id:'roa',client:id}),pat.id);await p.waitForTimeout(200);await p.fill('#f-soa','2025-10-01');await p.click('#rf button[type=submit]');
  await p.waitForFunction(()=>S.runs[0].status!=='running',null,{timeout:600000});log('roa',await p.evaluate(()=>[S.runs[0].status,S.runs[0].summary]));
  const [dl2]=await Promise.all([p.waitForEvent('download'),p.click('.doc [data-dl="0"]')]);await dl2.saveAs(__dirname+'/ROA-test.docx');
  log('STEP tax');await p.evaluate(id=>go('tool',{id:'tax-optimisation',client:id}),pat.id);await p.waitForTimeout(200);await p.click('#rf button[type=submit]');
  await p.waitForFunction(()=>S.runs[0].status!=='running',null,{timeout:60000});log('tax',await p.evaluate(()=>S.runs[0].summary));await p.screenshot({path:'E-tax.png',fullPage:true});
  log('STEP review');await p.evaluate(id=>go('tool',{id:'annual-review',client:id}),pat.id);await p.waitForTimeout(200);await p.click('#rf button[type=submit]');
  await p.waitForFunction(()=>S.runs[0].status!=='running',null,{timeout:600000});log('review',await p.evaluate(()=>[S.runs[0].status,S.runs[0].summary]));
  const [dl3]=await Promise.all([p.waitForEvent('download'),p.click('.doc [data-dl="1"]')]);await dl3.saveAs(__dirname+'/OFA-test.docx');
  // opportunities (rules) and Ask Brightly
  await p.click('#askbtn');await p.waitForTimeout(200);log('opps',await p.$$eval('.opp h3',e=>e.map(x=>x.textContent)));await p.screenshot({path:'E-opps.png',fullPage:true});
  log('STEP ask');await p.fill('#askq','Which clients would save the most by moving to DASH?');await p.press('#askq','Enter');await p.waitForFunction(()=>ASK.status!=='thinking',null,{timeout:600000});await p.waitForTimeout(300);
  log('ask',await p.evaluate(()=>[UI.view,ASK.result&&ASK.result.kind,ASK.result&&(ASK.result.items||[]).map(i=>i.title),ASK.result&&ASK.result.text,UI.filterFrom]));await p.screenshot({path:'E-ask.png',fullPage:true});
  // client pack round trip
  await p.click('#packsave');await p.fill('#dlgin','correct horse 1');await p.fill('#dlgin2','correct horse 1');
  const [dl4]=await Promise.all([p.waitForEvent('download'),p.click('dialog button[value=ok]')]);await dl4.saveAs(__dirname+'/pack.json');
  const packTxt=fs.readFileSync(__dirname+'/pack.json','utf8');log('pack encrypted',!/Tan|Patel/.test(packTxt),packTxt.length);
  await p.evaluate(()=>{S=emptyState();render()});
  await p.click('#packopen');const fc=await p.waitForEvent('filechooser');await fc.setFiles(__dirname+'/pack.json');await p.fill('#dlgin','correct horse 1');await p.click('dialog button[value=ok]');await p.waitForTimeout(1500);
  log('reopened',await p.evaluate(()=>[S.clients.map(c=>c.name),S.runs.length,PRACTICE.licensee,S.clients[0]&&S.clients[0].nextReview instanceof Date]));
  log('errors',errs);await b.close()})().catch(e=>{log('FAILED',e.message);process.exit(1)});
