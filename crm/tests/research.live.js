// Research end to end on a real server with live Yahoo data, starting from an empty workspace.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');
const ROOT = require('node:path').resolve(__dirname, '..') + ''; const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rlive-')); const PORT = 3997;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = (n, ok, extra) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || extra === undefined ? '' : ' :: ' + JSON.stringify(extra).slice(0, 500))); if (!ok) process.exitCode = 1; };
const req = (method, p, { body, cookie } = {}) => new Promise((resolve, reject) => { const data = body ? Buffer.from(JSON.stringify(body)) : null; const r = http.request({ host: '127.0.0.1', port: PORT, method, path: '/api/v1' + p, headers: { 'x-requested-with': 'brightday', ...(cookie ? { cookie } : {}), ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } }, (res) => { const ch = []; res.on('data', (c) => ch.push(c)); res.on('end', () => { const s = Buffer.concat(ch); let b; try { b = JSON.parse(s.toString() || '{}'); } catch { b = { bytes: s.length, head: s.slice(0, 5).toString() }; } resolve({ status: res.statusCode, headers: res.headers, body: b }); }); }); r.on('error', reject); if (data) r.write(data); r.end(); });
(async () => {
  process.env.DATA_DIR = DATA; process.env.ALLOW_UNENCRYPTED = '1';
  const D = require(ROOT + '/server/lib/db'); const auth = require(ROOT + '/server/lib/auth');
  D.users.insert({ id: 'u1', email: 'cc@x.com', name: 'Alex Morgan', role: 'Admin', status: 'Active', color: '#F50D74', pw_hash: auth.hashPassword('pw-1234567890') });
  D.kvSet('settings', { notifyPrefs: { events: [] }, security: { mfaRequired: 'none' } }); D.db.close();
  const srv = spawn('node', ['index.js'], { cwd: ROOT + '/server', env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), ALLOW_UNENCRYPTED: '1', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (c) => (log += c)); srv.stderr.on('data', (c) => (log += c));
  for (let i = 0; i < 50 && !/\[boot\] /.test(log); i++) await sleep(100);
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
  const errs = [];
  try {
    const c = (await req('POST', '/auth/login', { body: { email: 'cc@x.com', password: 'pw-1234567890' } })).headers['set-cookie'][0].split(';')[0];
    const recs = async (col) => ((await req('GET', '/sync?since=0', { cookie: c })).body.records || []).filter((x) => x.col === col && x.data).map((x) => x.data);
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } }); await ctx.addCookies([{ name: c.split('=')[0], value: c.split('=')[1], domain: '127.0.0.1', path: '/' }]);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
    const content = () => p.innerText('#content');
    const clean = async (label) => { const tx = await content(); const bad = (tx.match(/NaN|undefined|null%|\[object/g) || []); t(label + ': no NaN/undefined on screen', bad.length === 0, bad); };
    const go = async (h) => { await p.evaluate((x) => (location.hash = x), h); await sleep(500); };
    await p.goto(`http://127.0.0.1:${PORT}/#/research`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => typeof S === 'object' && S && S.loggedIn, null, { timeout: 15000 }); await sleep(800);
    t('empty workspace: Research shows the empty-library card', /research library is empty/i.test(await content()) && !!(await p.$('#content [data-starter]')));
    t('data bar says prices not fetched yet (not "Data live")', /Prices not fetched yet/i.test(await content()) && !/Data live/i.test(await content()), (await p.innerText('#content .databar')));
    // Starter library
    await p.click('#content [data-starter]');
    await p.waitForFunction(() => S.securities.length >= 12, null, { timeout: 150000 }); await sleep(1500);
    const vas = (await recs('securities')).find((s) => s.t === 'VAS.AX');
    t('starter library on the server (' + (await recs('securities')).length + ')', (await recs('securities')).length >= 12);
    t('VAS.AX is a complete record: price, yield 1-8%, 5y return, vol, distributions', vas && typeof vas.price === 'number' && vas.yld > 1 && vas.yld < 8 && typeof vas.ret.y5 === 'number' && typeof vas.vol === 'number' && (vas.divs || []).length >= 2 && vas.cls === 'Australian equities', vas && { yld: vas.yld, ret: vas.ret, divs: (vas.divs || []).length, desc: (vas.desc || '').length });
    t('no blank-string fields in any record', (await recs('securities')).every((s) => ['mer', 'beta', 'pe', 'yld', 'frank'].every((k) => s[k] !== '')));
    t('table lists every security', (await p.$$('#content tr[data-sec]')).length === (await p.evaluate(() => S.securities.length)));
    await p.waitForFunction(() => document.querySelectorAll('#content .spark svg').length > 5, null, { timeout: 60000 }).catch(() => {});
    t('sparklines drawn from real history', (await p.$$('#content .spark svg')).length > 5);
    await clean('securities tab');
    // Security page
    await go('#/security/VAS.AX'); await p.waitForSelector('#sec-chart, #content svg', { timeout: 30000 }).catch(() => {}); await sleep(600);
    const sp = await p.evaluate(() => { const c = document.querySelector('#content'); return { svg: !!c.querySelector('.card-body svg'), divRows: [...c.querySelectorAll('.card')].find((x) => /Distributions/.test(x.innerText))?.querySelectorAll('.task').length || 0, glance: c.querySelector('.ai .label')?.textContent, about: /about/i.test(c.innerText), dates: MARKET.dates['VAS.AX'] && MARKET.dates['VAS.AX'].length }; });
    t('security page: chart, real dates, 4 distributions, description, "At a glance" not "Claude"', sp.svg && sp.dates > 1000 && sp.divRows === 4 && sp.about && sp.glance === 'At a glance', sp);
    for (const r of ['1M', '5Y']) { await p.click(`[data-srange="${r}"]`); await sleep(200); }
    await clean('security page');
    // Lookup by name
    await go('#/research'); await p.click('#content .page-head [data-lookup]'); await p.fill('#lk-q', 'telstra'); await p.waitForSelector('.lk-row[data-lk="TLS.AX"]', { timeout: 30000 });
    t('lookup by name lists TLS.AX', true);
    await p.click('.lk-row[data-lk="TLS.AX"]'); await p.waitForFunction(() => location.hash === '#/security/TLS.AX' && !!sec('TLS.AX'), null, { timeout: 60000 }); await sleep(800);
    const tls = (await recs('securities')).find((s) => s.t === 'TLS.AX');
    t('picking it adds a complete TLS.AX record on the server, with a description', tls && tls.kind === 'Share' && tls.cls === 'Australian equities' && tls.sector && (tls.desc || '').length > 40 && typeof tls.ret.y1 === 'number', tls && { kind: tls.kind, cls: tls.cls, sector: tls.sector });
    await clean('TLS.AX page');
    // Exact US ticker: yield must be a sane percentage
    await go('#/research'); await p.click('#content .page-head [data-lookup]'); await p.fill('#lk-q', 'AAPL'); await p.waitForSelector('.lk-row[data-lk="AAPL"]', { timeout: 30000 }); await p.click('.lk-row[data-lk="AAPL"]');
    await p.waitForFunction(() => !!sec('AAPL'), null, { timeout: 60000 }); await sleep(500);
    const aapl = (await recs('securities')).find((s) => s.t === 'AAPL');
    t('AAPL yield is under 2% (was 32% from a units bug) and it is International equities', aapl && aapl.yld < 2 && aapl.cls === 'International equities', aapl && { yld: aapl.yld, cls: aapl.cls });
    // Edit details
    await go('#/security/TLS.AX'); await p.click('#content .toolbar [data-sec-edit]'); await p.fill('#mform [name=frank]', '100'); await p.fill('#mform [name=desc]', 'Telstra test description'); await p.click('#mform [type=submit]'); await sleep(1500);
    t('edit details saves franking and description to the server', ((await recs('securities')).find((s) => s.t === 'TLS.AX') || {}).frank === 100 && /test description/.test((await recs('securities')).find((s) => s.t === 'TLS.AX').desc));
    await req('POST', '/research/securities', { cookie: c, body: { t: 'TLS.AX' } }); const tls2 = (await recs('securities')).find((s) => s.t === 'TLS.AX');
    t('a refresh keeps the edited description and franking', tls2.frank === 100 && /test description/.test(tls2.desc));
    // Watchlist
    await p.evaluate(() => route()); await p.click('#content .toolbar [data-wl]'); await sleep(1000);
    t('watch star saves to the server watchlist', ((await req('GET', '/sync?since=0', { cookie: c })).body.kv || {}).watchlist?.includes('TLS.AX'));
    // Remove
    await p.click('#content [data-sec-del="TLS.AX"]'); await sleep(1500);
    t('remove takes TLS.AX out of the library on the server', !(await recs('securities')).some((s) => s.t === 'TLS.AX') && (await p.evaluate(() => location.hash)) === '#/research');
    // Models
    await p.click('[data-rtab="models"]'); await sleep(300);
    t('models tab empty state offers the starter models', /No model portfolios yet/.test(await content()));
    await p.click('#content [data-starter-models]'); await p.waitForFunction(() => S.models.length === 4, null, { timeout: 30000 });
    await p.waitForFunction(() => S.models.every((m) => { const x = portOf(m); return x && x.ok; }), null, { timeout: 90000 }).catch(() => {}); await sleep(800);
    t('4 starter models, drafts, with ETF benchmarks', await p.evaluate(() => S.models.map((m) => m.status + ':' + m.benchT).join() === 'Draft:VDCO.AX,Draft:VDBA.AX,Draft:VDGR.AX,Draft:VDHG.AX'));
    t('model cards show real 5-year figures (no …)', !/…/.test(await content()) && /5 yr p\.a\./.test(await content()));
    await sleep(1200); t('models saved on the server', (await recs('models')).length === 4);
    await clean('models tab');
    const bal = await p.evaluate(() => S.models.find((m) => m.name === 'BD Balanced').id);
    await go('#/model/' + bal); await p.waitForSelector('#content .legend2 span:nth-child(2)', { timeout: 60000 }).catch(() => {}); await sleep(600);
    const mv = await p.evaluate((id) => { const m = modelOf(id); const mm = modelMetrics(m); const c = document.querySelector('#content'); return { est: mm.est, ret5: mm.ret5, vol: mm.vol, legend: c.querySelector('.legend2')?.innerText, chart: !!c.querySelector('.card-body svg'), src: /yrs of month-end prices/.test(c.innerText) }; }, bal);
    t('model page: figures from real month-end series, chart with the VDBA benchmark line', !mv.est && typeof mv.ret5 === 'number' && mv.chart && /Balanced/.test(mv.legend) && mv.src, mv);
    await clean('model page');
    // Weight change refetches the series
    const before = mv.ret5; await p.fill('#content [data-hw="0"]', '60'); await p.dispatchEvent('#content [data-hw="0"]', 'change');
    await p.waitForFunction(([id, r]) => { const x = portOf(modelOf(id)); return x && x.ok && x.stats.y5 !== r; }, [bal, before], { timeout: 60000 }).catch(() => {});
    t('changing a weight recalculates the model from prices', await p.evaluate(([id, r]) => { const x = portOf(modelOf(id)); return !!(x && x.ok && x.stats.y5 !== r); }, [bal, before]));
    // Compare
    await go('#/research'); await p.click('[data-rtab="compare"]'); await p.waitForSelector('#content .legend2 span', { timeout: 60000 }).catch(() => {}); await sleep(500);
    t('compare tab charts the models from real prices', (await p.$$('#content .legend2 span')).length === 4 && /From month-end prices/.test(await content()));
    await clean('compare tab');
    // PDFs
    const fsx = await req('GET', '/research/securities/VAS.AX/factsheet.pdf', { cookie: c }); t('fact sheet PDF', fsx.status === 200 && fsx.body.head === '%PDF-', [fsx.status, fsx.body]);
    const pk = await req('GET', `/models/${bal}/pack.pdf?value=500000`, { cookie: c }); t('client pack PDF', pk.status === 200 && pk.body.head === '%PDF-', [pk.status, pk.body]);
    // Refresh now + settings
    const lr0 = await p.evaluate(() => S.settings.research.lastRefresh || '');
    await p.click('#content [data-mkt-refresh]'); await p.waitForFunction((x) => (S.settings.research.lastRefresh || '') !== x && !document.querySelector('#content [data-mkt-refresh][disabled]'), lr0, { timeout: 180000 }).catch(() => {}); await sleep(800);
    t('Refresh now runs, the bar reads "Prices current" and shows A$1 in US$', /Prices current/i.test(await content()) && /A\$1 = US\$0\.\d{4}/.test(await content()), (await p.innerText('#content .databar')));
    await go('#/settings/research'); await sleep(500);
    if (!(await p.$('#rs-mins'))) console.log('settings page:', await p.evaluate(() => location.hash), (await content()).slice(0, 500), errs);
    await p.selectOption('#rs-mins', '60'); await sleep(1200);
    t('refresh interval saves to the server', ((await req('GET', '/sync?since=0', { cookie: c })).body.kv.settings.research || {}).refreshMins === 60);
    await clean('research settings');
    await p.screenshot({ path: require('node:os').tmpdir() + '/rlive-settings.jpg', type: 'jpeg', quality: 60 });
    // Missing ticker page offers to add
    await go('#/security/VHY.AX'); t('an unknown ticker page offers "Add VHY.AX to the library"', !!(await p.$('#content [data-sec-add="VHY.AX"]')));
    t('no page errors', errs.length === 0, errs);
  } finally { await b.close(); srv.kill('SIGTERM'); }
  if (process.exitCode) console.log(log.split('\n').filter((l) => !/Experimental|trace-warnings/.test(l)).slice(-20).join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
