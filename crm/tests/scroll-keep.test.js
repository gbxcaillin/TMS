// Background re-draws keep your place: with a long Research library scrolled down, a live update re-drawing the page
// (softRoute, what live sync and arriving charts use) or a plain re-render leaves the scroll where it was, while
// switching tab or opening another page starts at the top. Seeded made-up funds, no network.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');
const ROOT = path.resolve(__dirname, '..'); const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'scroll-')); const PORT = 3979;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = (n, ok, extra) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || extra === undefined ? '' : ' :: ' + JSON.stringify(extra).slice(0, 400))); if (!ok) process.exitCode = 1; };
const req = (method, p, { body, cookie } = {}) => new Promise((resolve, reject) => { const data = body ? Buffer.from(JSON.stringify(body)) : null; const r = http.request({ host: '127.0.0.1', port: PORT, method, path: '/api/v1' + p, headers: { 'x-requested-with': 'brightday', ...(cookie ? { cookie } : {}), ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } }, (res) => { let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => { let b; try { b = JSON.parse(s || '{}'); } catch { b = {}; } resolve({ status: res.statusCode, headers: res.headers, body: b }); }); }); r.on('error', reject); if (data) r.write(data); r.end(); });
(async () => {
  process.env.DATA_DIR = DATA; process.env.ALLOW_UNENCRYPTED = '1';
  const D = require(ROOT + '/server/lib/db'); const auth = require(ROOT + '/server/lib/auth');
  D.users.insert({ id: 'u1', email: 'cc@x.com', name: 'Alex Morgan', role: 'Admin', status: 'Active', color: '#F50D74', pw_hash: auth.hashPassword('pw-1234567890') });
  D.kvSet('settings', { notifyPrefs: { events: [] }, security: { mfaRequired: 'none' }, research: { starterAt: '2026-01-01T00:00:00', indicesAt: '2026-01-01T00:00:00', topAsxAt: '2026-01-01T00:00:00', refreshMins: 1440, lastRefresh: D.nowIso() } });
  // Unlisted funds (provider "reference") so the page asks for no price history.
  for (let i = 0; i < 80; i++) { const code = 'TST' + String(1000 + i) + 'AU'; D.putRecord('securities', { t: code, name: 'Sample Test Fund ' + (i + 1), kind: 'Managed fund', cls: 'Multi‑asset', ex: 'Unlisted', ccy: 'AUD', price: null, chg: null, w52: [null, null], mcap: '', pe: null, yld: null, frank: null, mer: 0.5, beta: null, ret: { m1: 1, m3: 2, y1: 5, y3: 6, y5: 7 }, vol: 8, mdd: -10, provider: 'reference' }, 'market'); }
  D.db.close();
  const srv = spawn('node', ['index.js'], { cwd: ROOT + '/server', env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), ALLOW_UNENCRYPTED: '1', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (c) => (log += c)); srv.stderr.on('data', (c) => (log += c));
  for (let i = 0; i < 50 && !/\[boot\] /.test(log); i++) await sleep(100);
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined }); const errs = [];
  try {
    const c = (await req('POST', '/auth/login', { body: { email: 'cc@x.com', password: 'pw-1234567890' } })).headers['set-cookie'][0].split(';')[0];
    const ctx = await b.newContext({ viewport: { width: 1400, height: 800 } }); await ctx.addCookies([{ name: c.split('=')[0], value: c.split('=')[1], domain: '127.0.0.1', path: '/' }]);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`http://127.0.0.1:${PORT}/#/research`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => typeof S === 'object' && S && S.loggedIn && document.querySelectorAll('#content tr[data-sec]').length === 80, null, { timeout: 15000 }); await sleep(800);
    const top = () => p.evaluate(() => document.querySelector('#content').scrollTop);
    await p.evaluate(() => { document.querySelector('#content').scrollTop = 1500; }); await sleep(200); const s0 = await top();
    t('the library is long enough to scroll', s0 > 1000, s0);
    await p.evaluate(() => softRoute()); await sleep(300);
    t('a background re-draw (live update, charts arriving) keeps the scroll position', Math.abs((await top()) - s0) <= 2, { s0, now: await top() });
    await p.evaluate(() => route()); await sleep(300);
    t('re-rendering the same page after a save keeps it too', Math.abs((await top()) - s0) <= 2, { s0, now: await top() });
    await p.evaluate(() => { const y = sec('TST1040AU'); y.desc = 'Changed while you were reading.'; save(); }); await sleep(2500);
    t('a change synced while scrolled down leaves the position alone', Math.abs((await top()) - s0) <= 2, { s0, now: await top() });
    await p.click('#content [data-rtab="models"]'); await sleep(400);
    t('switching to another tab starts at the top', (await top()) === 0);
    await p.click('#content [data-rtab="securities"]'); await p.evaluate(() => { document.querySelector('#content').scrollTop = 1200; }); await sleep(200);
    await p.evaluate(() => { location.hash = '#/tasks'; }); await sleep(400); await p.evaluate(() => { document.querySelector('#content').scrollTop = 0; });
    await p.evaluate(() => { location.hash = '#/research'; }); await sleep(500);
    t('opening another page, then coming back, starts at the top', (await top()) === 0);
    t('no page errors', errs.length === 0, errs);
  } finally { await b.close(); srv.kill('SIGTERM'); }
  if (process.exitCode) console.log(log.split('\n').filter((l) => !/Experimental|trace-warnings/.test(l)).slice(-15).join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
