const setup=require('./replay.test.js');
(async()=>{const {b,p}=await setup();const tan=await p.evaluate(()=>S.clients.find(c=>/Tan/.test(c.name)).id);
  await p.evaluate(id=>go('tool',{id:'soa',client:id}),tan);await p.waitForTimeout(200);await p.screenshot({path:'C-form.png',fullPage:true});await p.click('#rf button[type=submit]');
  await p.waitForFunction(()=>S.runs[0].status!=='running');await p.waitForTimeout(300);console.log(await p.evaluate(()=>S.runs[0].docs.map(d=>d.n)));
  const [d]=await Promise.all([p.waitForEvent('download'),p.click('.doc [data-dl="1"]')]);await d.saveAs(__dirname+'/CONSENT-test.docx');
  await p.click('[data-pv="0"]');await p.waitForTimeout(200);const el=await p.$('#prev0');await el.screenshot({path:'C-soa.png'});
  console.log('errors',p.errs);await b.close()})();
