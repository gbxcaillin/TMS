// Company lists in Settings, Research: a CSV of ASX codes (Code, Company) is accepted next to the Morningstar exports,
// its companies are added to the library in the background and tagged with the list's name, a code already in the
// library just gains the tag, a code that has gone is reported, a code that now belongs to another company is not
// added, and a security whose code left the list loses the tag. Made-up codes with their prices seeded in the market
// cache, so no network is needed (ZZQX has no cache entry and is not a real code).
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');
const ROOT = path.resolve(__dirname, '..'); const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'clist-')); const PORT = 3978;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = (n, ok, extra) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || extra === undefined ? '' : ' :: ' + JSON.stringify(extra).slice(0, 400))); if (!ok) process.exitCode = 1; };
const req = (method, p, { body, cookie } = {}) => new Promise((resolve, reject) => { const data = body ? Buffer.from(JSON.stringify(body)) : null; const r = http.request({ host: '127.0.0.1', port: PORT, method, path: '/api/v1' + p, headers: { 'x-requested-with': 'acme', ...(cookie ? { cookie } : {}), ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } }, (res) => { let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => { let b; try { b = JSON.parse(s || '{}'); } catch { b = {}; } resolve({ status: res.statusCode, headers: res.headers, body: b }); }); }); r.on('error', reject); if (data) r.write(data); r.end(); });
(async () => {
  process.env.DATA_DIR = DATA; process.env.ALLOW_UNENCRYPTED = '1';
  const D = require(ROOT + '/server/lib/db'); const auth = require(ROOT + '/server/lib/auth'); const refdata = require(ROOT + '/server/lib/refdata'); const market = require(ROOT + '/server/lib/market');
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'asx-list-sample.csv'), 'utf8');
  const p = refdata.parseExport(text);
  t('a Code, Company file is read as a list, duplicates and ASX: prefixes folded', p.kind === 'list' && p.codes.join() === 'TQA,TQB,TQP,CBA,TQO,ZZQX' && p.names.TQB === 'Test Bank Beta Limited', p);
  t('a file with neither shape is still refused', (() => { try { refdata.parseExport('a,b,c\n1,2,3\n'); return false; } catch (e) { return /not a Morningstar export or a list of ASX codes/.test(e.message); } })());
  t('the list is named after the file', refdata.listName('ASX_200.csv') === 'ASX 200' && refdata.listName('Sample 40.csv') === 'Sample 40');
  t('a renamed company still matches; a reused code does not', market.sameCompany('Australia and New Zealand Banking Group Ltd', 'ANZ Group Holdings Limited', 'ANZ') && market.sameCompany('BHP Group', 'BHP Group Limited', 'BHP') && !market.sameCompany('Altium Ltd', 'Alurion Resources Limited', 'ALU'));
  D.users.insert({ id: 'u1', email: 'cc@x.com', name: 'Alex Morgan', role: 'Admin', status: 'Active', color: '#3559E0', pw_hash: auth.hashPassword('pw-1234567890') });
  D.kvSet('settings', { notifyPrefs: { events: [] }, security: { mfaRequired: 'none' }, research: { starterAt: '2026-01-01T00:00:00', indicesAt: '2026-01-01T00:00:00', topAsxAt: '2026-01-01T00:00:00', refreshMins: 1440, lastRefresh: D.nowIso() } });
  const base = { kind: 'Share', cls: 'Australian equities', ex: 'ASX', ccy: 'AUD', chg: 0.2, w52: [10, 20], mcap: '', pe: 15, yld: 4, frank: 100, mer: null, beta: 1, ret: { m1: 1, m3: 2, y1: 4, y3: 11, y5: 7.5 }, vol: 18, mdd: -25, provider: 'yahoo' };
  D.putRecord('securities', { ...base, t: 'CBA.AX', name: 'Commonwealth Bank of Australia', price: 151.5, asxRank: 1, note: 'Kept.' }, 'market');
  D.putRecord('securities', { ...base, t: 'OLD.AX', name: 'Old Member Limited', price: 2.1, lists: ['Sample 40'] }, 'market');
  // Market cache for the made-up codes: a quote, five years of prices and a profile each.
  const pts = []; for (let i = 0; i < 400; i++) { const d = new Date(Date.UTC(2025, 0, 1) + i * 864e5).toISOString().slice(0, 10); pts.push({ d, c: 10 + i / 100, a: 10 + i / 100 }); }
  const seed = (code, name, sector) => { const tk = code + '.AX'; D.cache.set('q2:' + tk, { t: tk, name, price: 14, chg: 0.5, ccy: 'AUD', ex: 'ASX', mcap: 'A$1.2b', pe: 12, yld: 3.5, mer: null, w52: [10, 15], kind: 'Share', qtype: 'EQUITY', asOf: D.nowIso(), src: 'Yahoo Finance' }); D.cache.set(`h2:${tk}:5`, { t: tk, pts, divs: [], stats: { m1: 1, m3: 2, y1: 30, y3: null, y5: null, vol: 5, mdd: -1, years: 1.6 }, asOf: D.nowIso() }); D.cache.set('p:' + tk, { desc: 'A made-up company for tests.', sector, beta: 1.1, mer: null, family: '' }); };
  seed('TQA', 'Test Quarry Alpha Limited', 'Basic Materials'); seed('TQB', 'Test Bank Beta Ltd', 'Financial Services'); seed('TQP', 'Test Property Group', 'Real Estate'); seed('TQO', 'Unrelated Minerals Limited', 'Basic Materials');
  D.db.close();
  const srv = spawn('node', ['index.js'], { cwd: ROOT + '/server', env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), ALLOW_UNENCRYPTED: '1', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (c) => (log += c)); srv.stderr.on('data', (c) => (log += c));
  for (let i = 0; i < 50 && !/\[boot\] /.test(log); i++) await sleep(100);
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined }); const errs = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clist-up-')); const file = path.join(tmp, 'Sample 40.csv'); fs.writeFileSync(file, text);
  try {
    const c = (await req('POST', '/auth/login', { body: { email: 'cc@x.com', password: 'pw-1234567890' } })).headers['set-cookie'][0].split(';')[0];
    const secs = async () => Object.fromEntries(((await req('GET', '/sync?since=0', { cookie: c })).body.records || []).filter((x) => x.col === 'securities' && x.data).map((x) => [x.id, x.data]));
    const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } }); await ctx.addCookies([{ name: c.split('=')[0], value: c.split('=')[1], domain: '127.0.0.1', path: '/' }]);
    const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
    await pg.goto(`http://127.0.0.1:${PORT}/#/settings/research`, { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() => typeof S === 'object' && S && S.loggedIn, null, { timeout: 15000 }); await sleep(1200);
    t('the upload button offers ASX lists too', /Upload a Morningstar export or ASX list/i.test(await pg.innerText('#ref-card')));
    await pg.setInputFiles('#ref-file', [file]);
    await pg.waitForFunction(() => /added, \d+ already in the library/.test((document.querySelector('[data-listprog]') || {}).textContent || ''), null, { timeout: 60000 });
    const prog = await pg.innerText('[data-listprog]'); const card = await pg.innerText('#ref-card');
    t('the card lists the file as a company list of 6 codes', /Sample 40\.csv/.test(card) && /Company list: Sample 40/.test(card) && /\b6\b/.test(card), card.slice(0, 500));
    t('it reports 3 added and 1 already in the library', /3 added, 1 already in the library/.test(prog), prog);
    t('the code that has gone is reported as not found', /Not found[^.]*ZZQX/.test(prog), prog);
    t('the reused code is reported and not added', /TQO \(Old Name Holdings Ltd, now Unrelated Minerals Limited\)/.test(prog), prog);
    const s = await secs();
    t('new companies are shares tagged with the list, the property trust in property', s['TQA.AX'] && s['TQA.AX'].kind === 'Share' && s['TQA.AX'].cls === 'Australian equities' && s['TQA.AX'].lists.join() === 'Sample 40' && s['TQP.AX'].cls === 'Property & infrastructure' && s['TQB.AX'], Object.keys(s));
    t('CBA already in the library gains the tag and keeps its note', s['CBA.AX'].lists.join() === 'Sample 40' && s['CBA.AX'].note === 'Kept.');
    t('the reused and missing codes are not in the library', !s['TQO.AX'] && !s['ZZQX.AX']);
    t('a security whose code left the list loses the tag but stays', s['OLD.AX'] && !s['OLD.AX'].lists);
    await pg.evaluate(() => { location.hash = '#/research'; }); await sleep(900);
    t('library rows carry the list tag', /Sample 40/i.test(await pg.innerText('#content tr[data-sec="TQA.AX"]')) && /ASX 20/i.test(await pg.innerText('#content tr[data-sec="CBA.AX"]')));
    await pg.fill('#sec-q', 'sample 40'); await sleep(600);
    t('filtering by the list name shows its four companies', (await pg.$$('#content tr[data-sec]')).length === 4);
    const bad = ((await pg.innerText('#content')).match(/NaN|undefined/g) || []); t('no NaN or undefined', !bad.length, bad);
    t('no page errors', errs.length === 0, errs);
  } finally { await b.close(); srv.kill('SIGTERM'); }
  if (process.exitCode) console.log(log.split('\n').filter((l) => !/Experimental|trace-warnings/.test(l)).slice(-15).join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
