// Largest ASX shares: the ASX 20/50 list is sound (50 unique codes, the big four banks in the top 20), library rows
// show their ASX 20 / ASX 50 tag, the filter finds them, and the Add ASX top shares dialog shows what is already in
// the library and asks the server for the chosen set. Seeded records and a mocked request, so no network.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');
const ROOT = path.resolve(__dirname, '..'); const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'topasx-')); const PORT = 3977;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = (n, ok, extra) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || extra === undefined ? '' : ' :: ' + JSON.stringify(extra).slice(0, 400))); if (!ok) process.exitCode = 1; };
const req = (method, p, { body, cookie } = {}) => new Promise((resolve, reject) => { const data = body ? Buffer.from(JSON.stringify(body)) : null; const r = http.request({ host: '127.0.0.1', port: PORT, method, path: '/api/v1' + p, headers: { 'x-requested-with': 'acme', ...(cookie ? { cookie } : {}), ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } }, (res) => { let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => { let b; try { b = JSON.parse(s || '{}'); } catch { b = {}; } resolve({ status: res.statusCode, headers: res.headers, body: b }); }); }); r.on('error', reject); if (data) r.write(data); r.end(); });
(async () => {
  process.env.DATA_DIR = DATA; process.env.ALLOW_UNENCRYPTED = '1';
  const D = require(ROOT + '/server/lib/db'); const auth = require(ROOT + '/server/lib/auth'); const market = require(ROOT + '/server/lib/market');
  const L = market.ASX_TOP;
  t('the list has 50 unique ASX codes', L.length === 50 && new Set(L).size === 50 && L.every((c) => /^[A-Z0-9]{3}$/.test(c)));
  t('the big four banks, BHP and CSL are in the top 20', ['CBA', 'NAB', 'WBC', 'ANZ', 'BHP', 'CSL'].every((c) => L.indexOf(c) >= 0 && L.indexOf(c) < 20));
  t('rank lookups: CBA.AX is 1, a code outside the list has none', market.asxRank('CBA.AX') === 1 && market.asxRank('ZZZ.AX') === null);
  D.users.insert({ id: 'u1', email: 'cc@x.com', name: 'Alex Morgan', role: 'Admin', status: 'Active', color: '#3559E0', pw_hash: auth.hashPassword('pw-1234567890') });
  D.kvSet('settings', { notifyPrefs: { events: [] }, security: { mfaRequired: 'none' }, research: { starterAt: '2026-01-01T00:00:00', indicesAt: '2026-01-01T00:00:00', topAsxAt: '2026-01-01T00:00:00', refreshMins: 1440, lastRefresh: D.nowIso() } });
  const base = { kind: 'Share', cls: 'Australian equities', ex: 'ASX', ccy: 'AUD', chg: 0.2, w52: [10, 20], mcap: '', pe: 15, yld: 4, frank: 100, mer: null, beta: 1, ret: { m1: 1, m3: 2, y1: 4, y3: 11, y5: 7.5 }, vol: 18, mdd: -25, provider: 'yahoo' };
  D.putRecord('securities', { ...base, t: 'CBA.AX', name: 'Commonwealth Bank of Australia', price: 151.5, asxRank: 1 }, 'market');
  D.putRecord('securities', { ...base, t: 'NAB.AX', name: 'National Australia Bank Limited', price: 39.1, asxRank: 4 }, 'market');
  D.putRecord('securities', { ...base, t: 'SCG.AX', name: 'Scentre Group', cls: 'Property & infrastructure', price: 3.4, asxRank: 29 }, 'market');
  D.putRecord('securities', { ...base, t: 'VAS.AX', name: 'Vanguard Australian Shares Index ETF', kind: 'ETF', price: 108.85 }, 'market');
  D.db.close();
  const srv = spawn('node', ['index.js'], { cwd: ROOT + '/server', env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), ALLOW_UNENCRYPTED: '1', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (c) => (log += c)); srv.stderr.on('data', (c) => (log += c));
  for (let i = 0; i < 50 && !/\[boot\] /.test(log); i++) await sleep(100);
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined }); const errs = [];
  try {
    const c = (await req('POST', '/auth/login', { body: { email: 'cc@x.com', password: 'pw-1234567890' } })).headers['set-cookie'][0].split(';')[0];
    const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } }); await ctx.addCookies([{ name: c.split('=')[0], value: c.split('=')[1], domain: '127.0.0.1', path: '/' }]);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`http://127.0.0.1:${PORT}/#/research`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => typeof S === 'object' && S && S.loggedIn, null, { timeout: 15000 }); await sleep(700);
    const row = (tk) => p.innerText(`#content tr[data-sec="${tk}"]`);
    t('rows carry their tag: CBA and NAB "ASX 20", Scentre "ASX 50", VAS none', /ASX 20/i.test(await row('CBA.AX')) && /ASX 20/i.test(await row('NAB.AX')) && /ASX 50/i.test(await row('SCG.AX')) && !/ASX \d0/i.test(await row('VAS.AX')));
    await p.fill('#sec-q', 'asx 20'); await sleep(600);
    t('filtering "asx 20" shows just the two ASX 20 shares', (await p.$$('#content tr[data-sec]')).length === 2);
    await p.fill('#sec-q', 'asx 50'); await sleep(600);
    t('filtering "asx 50" shows all three ranked shares', (await p.$$('#content tr[data-sec]')).length === 3);
    await p.fill('#sec-q', ''); await sleep(600);
    let hit = null; await p.route('**/api/v1/research/top-asx', async (rt) => { hit = JSON.parse(rt.request().postData()); await rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ started: true, n: hit.n }) }); });
    await p.click('#content [data-topasx]'); await sleep(300);
    const dlg = await p.innerText('.modal');
    t('the dialog offers ASX 20 and ASX 50 with what is already in the library (2 and 3)', /ASX 20[\s\S]*2 already in the library[\s\S]*ASX 50[\s\S]*3 already in the library/.test(dlg), dlg.slice(0, 400));
    await p.click('.modal input[value="50"]'); await p.click('.modal [type=submit]'); await sleep(800);
    t('choosing ASX 50 asks the server for 50 and says they are on their way', hit && hit.n === 50 && /Adding the ASX 50/.test(await p.innerText('body')), hit);
    const r = await req('POST', '/research/top-asx', { body: { n: 7 } }); t('the endpoint needs a signed-in user', r.status === 401);
    const bad = ((await p.innerText('#content')).match(/NaN|undefined/g) || []); t('no NaN or undefined', !bad.length, bad);
    t('no page errors', errs.length === 0, errs);
  } finally { await b.close(); srv.kill('SIGTERM'); }
  if (process.exitCode) console.log(log.split('\n').filter((l) => !/Experimental|trace-warnings/.test(l)).slice(-15).join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
