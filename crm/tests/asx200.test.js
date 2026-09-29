// The S&P/ASX 200 in Research: shown in points (not dollars) in the prices line, the table and its own page, with
// the returns labelled as a price index, and kept out of model holdings. Seeded record, no network.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');
const ROOT = path.resolve(__dirname, '..'); const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'axjo-')); const PORT = 3976;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = (n, ok, extra) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || extra === undefined ? '' : ' :: ' + JSON.stringify(extra).slice(0, 400))); if (!ok) process.exitCode = 1; };
const req = (method, p, { body, cookie } = {}) => new Promise((resolve, reject) => { const data = body ? Buffer.from(JSON.stringify(body)) : null; const r = http.request({ host: '127.0.0.1', port: PORT, method, path: '/api/v1' + p, headers: { 'x-requested-with': 'brightday', ...(cookie ? { cookie } : {}), ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } }, (res) => { let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => { let b; try { b = JSON.parse(s || '{}'); } catch { b = {}; } resolve({ status: res.statusCode, headers: res.headers, body: b }); }); }); r.on('error', reject); if (data) r.write(data); r.end(); });
(async () => {
  process.env.DATA_DIR = DATA; process.env.ALLOW_UNENCRYPTED = '1';
  const D = require(ROOT + '/server/lib/db'); const auth = require(ROOT + '/server/lib/auth');
  D.users.insert({ id: 'u1', email: 'cc@x.com', name: 'Alex Morgan', role: 'Admin', status: 'Active', color: '#F50D74', pw_hash: auth.hashPassword('pw-1234567890') });
  D.kvSet('settings', { notifyPrefs: { events: [] }, security: { mfaRequired: 'none' }, research: { starterAt: '2026-01-01T00:00:00', indicesAt: '2026-01-01T00:00:00', refreshMins: 1440, lastRefresh: D.nowIso() } });
  D.putRecord('securities', { t: '^AXJO', name: 'S&P/ASX 200 [XJO]', kind: 'Index', cls: 'Australian equities', ex: 'ASX', ccy: 'AUD', price: 8679.7, chg: 0.17, w52: [8262.4, 9296.7], mcap: '', pe: null, yld: null, frank: 0, mer: null, beta: null, ret: { m1: -4.1, m3: -1.3, y1: -2.2, y3: 7.2, y5: 3.8 }, vol: 12.8, mdd: -15, provider: 'yahoo', desc: 'The S&P/ASX 200 price index.' }, 'market');
  D.putRecord('securities', { t: 'VAS.AX', name: 'Vanguard Australian Shares Index ETF', kind: 'ETF', cls: 'Australian equities', ex: 'ASX', ccy: 'AUD', price: 108.85, chg: 0.2, w52: [100, 115], mcap: '', pe: 19, yld: 2.9, frank: 75, mer: 0.07, beta: 1, ret: { m1: 1, m3: 2, y1: 4, y3: 11, y5: 7.5 }, vol: 12.8, mdd: -15, provider: 'yahoo' }, 'market');
  D.putRecord('models', { id: 1, name: 'BD Balanced', risk: 'Balanced', benchmark: '', benchT: '^AXJO', minInv: 50000, rebal: '', status: 'Draft', owner: 'u1', updated: D.today(), deal: 0, notes: '', holdings: [{ t: 'VAS.AX', w: 100 }] }, 'u1');
  D.db.close();
  const srv = spawn('node', ['index.js'], { cwd: ROOT + '/server', env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), ALLOW_UNENCRYPTED: '1', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (c) => (log += c)); srv.stderr.on('data', (c) => (log += c));
  for (let i = 0; i < 50 && !/\[boot\] /.test(log); i++) await sleep(100);
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined }); const errs = [];
  try {
    const c = (await req('POST', '/auth/login', { body: { email: 'cc@x.com', password: 'pw-1234567890' } })).headers['set-cookie'][0].split(';')[0];
    const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } }); await ctx.addCookies([{ name: c.split('=')[0], value: c.split('=')[1], domain: '127.0.0.1', path: '/' }]);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    const content = () => p.innerText('#content');
    await p.goto(`http://127.0.0.1:${PORT}/#/research`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => typeof S === 'object' && S && S.loggedIn, null, { timeout: 15000 }); await sleep(700);
    const bar = await p.innerText('#content .databar');
    t('the prices line shows the S&P/ASX 200 level and its day move', /S&P\/ASX 200 8,679\.7 \+0\.17%/.test(bar), bar);
    t('the table shows the index in points with separators, not dollars', /8,679\.7/.test(await p.innerText('#content tr[data-sec="^AXJO"]')));
    await p.click('#content .databar a[href="#/security/%5EAXJO"]'); await sleep(700);
    const pg = await content();
    t('its page shows the level in points', /8,679\.7 pts/.test(pg) && !/A\$8,?679/.test(pg), pg.slice(0, 300));
    t('returns are labelled as a price index, without dividends', /Price index: returns exclude dividends/.test(pg));
    t('no Add to model and no management fee for an index', !(await p.$('#content [data-addto]')) && !/Management fee/i.test(pg));
    await p.evaluate(() => { location.hash = '#/model/1'; }); await sleep(700);
    t('the model\'s Add security list leaves the index out', !(await p.$('#model-add option[value="^AXJO"]')) && !!(await p.$('#model-add')));
    t('adding an index to a model by other routes is refused with a reason', await p.evaluate(() => { let msg = ''; const o = window.toast; window.toast = (m) => { msg = m; }; openAddToModel('^AXJO'); window.toast = o; return /benchmark, not a holding/.test(msg) && !document.querySelector('#mform'); }));
    const bad = ((await content()).match(/NaN|undefined/g) || []); t('no NaN or undefined', !bad.length, bad);
    t('no page errors', errs.length === 0, errs);
  } finally { await b.close(); srv.kill('SIGTERM'); }
  if (process.exitCode) console.log(log.split('\n').filter((l) => !/Experimental|trace-warnings/.test(l)).slice(-15).join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
