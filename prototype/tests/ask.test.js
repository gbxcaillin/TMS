const { chromium } = require('playwright');
const html = require('fs').readFileSync(require('path').join(__dirname,'..','brightday-portal.html'), 'utf8');
const doc = '<!doctype html><html><head><meta charset="utf-8"></head><body>' + html + '</body></html>';
async function page(b, mock) {
  const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
  p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  if (mock) await p.addInitScript(mock);
  require('fs').writeFileSync(__dirname+'/doc.html',doc);await p.goto('file://'+__dirname+'/doc.html'); await p.click('#login .btn-primary'); await p.waitForTimeout(200);
  return p;
}
const ask = async (p, q) => { await p.click('#askbtn'); await p.waitForTimeout(100); await p.fill('#askq', q); await p.press('#askq', 'Enter'); await p.waitForTimeout(400); };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  // 1) rules fallback
  let p = await page(b);
  await p.screenshot({ path: 'a-dash.png' });
  await ask(p, 'show me all the ART clients with 200k balance on ongoing fees');
  const names = await p.$$eval('main tbody tr b', e => e.map(x => x.textContent));
  console.log('ART filter ->', names.filter(n => /&|Wilson|Priya|Mei/.test(n)));
  await p.screenshot({ path: 'a-filter.png', fullPage: true });
  await ask(p, 'show me the biggest opportunities to connect with my clients and offer value');
  console.log('opps ->', (await p.$$eval('.opp h3', e => e.map(x => x.textContent))).slice(0, 6));
  await p.screenshot({ path: 'a-opps.png', fullPage: true });
  await ask(p, 'Which clients hold shares Pearl rates Sell?');
  console.log('pearl sell ->', await p.$$eval('main tbody tr td:first-child b', e => e.map(x => x.textContent)));
  await ask(p, 'Who is waiting for a reply to their email?');
  console.log('email ->', await p.$eval('.answer', e => e.innerText.slice(0, 200)));
  await p.click('[data-go="clients"]'); await p.selectOption('#f-pearl', 'Buy'); await p.waitForTimeout(200);
  console.log('filter panel Buy ->', await p.$$eval('main tbody tr td:first-child b', e => e.map(x => x.textContent)));
  console.log('errors rules:', p.errs);
  // 2) Claude path (mocked sampler)
  const mock = () => { window.claude = { use: async n => { if (n !== 'sample') return null; const f = async () => ({ text: '' }); f.json = async (input) => { window.__prompt = input; await new Promise(r => setTimeout(r, 800));
    if (/ART/.test(input.split('QUESTION:')[1])) return { kind: 'filter', title: 'ART $200k+', explain: 'An ART account of at least $200,000 for clients on ongoing fees.', filters: { provider: 'ART', minBalance: 200000, feeType: 'ongoing' } };
    return { kind: 'insights', title: 'Where to add value this week', items: [{ client: 'wilson', title: 'Harvest losses (mock)', why: 'x', evidence: ['e'], tool: 'tax-optimisation', signal: 'wilson:harvest', size: 'high' }, { client: 'nobody', title: 'bad' }] }; }; return f; } }; };
  p = await page(b, mock); await p.waitForTimeout(300);
  await ask(p, 'show me all the ART clients with 200k balance on ongoing fees');
  await p.screenshot({ path: 'c-thinking.png' });
  await p.waitForTimeout(1200);
  console.log('claude filter ->', await p.$$eval('main tbody tr td:first-child b', e => e.map(x => x.textContent)), await p.$eval('.aibar', e => e.innerText.slice(0, 80)));
  await ask(p, 'biggest opportunities'); await p.waitForTimeout(1200);
  console.log('claude opps ->', await p.$$eval('.opp h3', e => e.map(x => x.textContent)), await p.$eval('.card-head .chip', e => e.textContent));
  const plen = await p.evaluate(() => window.__prompt.length); console.log('prompt chars', plen);
  await p.screenshot({ path: 'c-opps.png', fullPage: true });
  console.log('errors claude:', p.errs);
  await p.setViewportSize({ width: 390, height: 844 }); await p.click('[data-go="ask"]'); await p.waitForTimeout(200);
  console.log('mobile width', await p.evaluate(() => document.documentElement.scrollWidth)); await p.screenshot({ path: 'c-mobile.png', fullPage: true });
  await b.close();
})();
