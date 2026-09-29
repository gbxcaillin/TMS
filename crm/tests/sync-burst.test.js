// A burst of live updates (the server adding a batch of securities, say) must not postpone saving a change: an edit
// made while the browser is pulling every 150 ms reaches the server within a couple of seconds.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');
const ROOT = path.resolve(__dirname, '..'); const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'burst-')); const PORT = 3978;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = (n, ok, extra) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || extra === undefined ? '' : ' :: ' + JSON.stringify(extra).slice(0, 300))); if (!ok) process.exitCode = 1; };
const req = (method, p, { body, cookie } = {}) => new Promise((resolve, reject) => { const data = body ? Buffer.from(JSON.stringify(body)) : null; const r = http.request({ host: '127.0.0.1', port: PORT, method, path: '/api/v1' + p, headers: { 'x-requested-with': 'brightday', ...(cookie ? { cookie } : {}), ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } }, (res) => { let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => { let b; try { b = JSON.parse(s || '{}'); } catch { b = {}; } resolve({ status: res.statusCode, headers: res.headers, body: b }); }); }); r.on('error', reject); if (data) r.write(data); r.end(); });
(async () => {
  process.env.DATA_DIR = DATA; process.env.ALLOW_UNENCRYPTED = '1';
  const D = require(ROOT + '/server/lib/db'); const auth = require(ROOT + '/server/lib/auth');
  D.users.insert({ id: 'u1', email: 'cc@x.com', name: 'Alex Morgan', role: 'Admin', status: 'Active', color: '#F50D74', pw_hash: auth.hashPassword('pw-1234567890') });
  D.kvSet('settings', { notifyPrefs: { events: [] }, security: { mfaRequired: 'none' }, research: { starterAt: 'x', indicesAt: 'x', topAsxAt: 'x', refreshMins: 1440, lastRefresh: D.nowIso() } });
  D.kvSet('stages', [{ id: 'new', name: 'New lead' }, { id: 'won', name: 'Won', closed: 'won' }]);
  D.putRecord('deals', { id: 1, practice: 'Alpha Advisers', contact: 'A', email: 'a@x.com', stage: 'new', value: 1000, owner: 'u1', created: D.today(), source: 'website' }, 'u1');
  D.db.close();
  const srv = spawn('node', ['index.js'], { cwd: ROOT + '/server', env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), ALLOW_UNENCRYPTED: '1', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (c) => (log += c)); srv.stderr.on('data', (c) => (log += c));
  for (let i = 0; i < 50 && !/\[boot\] /.test(log); i++) await sleep(100);
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined }); const errs = [];
  try {
    const c = (await req('POST', '/auth/login', { body: { email: 'cc@x.com', password: 'pw-1234567890' } })).headers['set-cookie'][0].split(';')[0];
    const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } }); await ctx.addCookies([{ name: c.split('=')[0], value: c.split('=')[1], domain: '127.0.0.1', path: '/' }]);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`http://127.0.0.1:${PORT}/#/pipeline`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => typeof S === 'object' && S && S.loggedIn, null, { timeout: 15000 }); await sleep(500);
    // Pull every 150 ms for 4 s (what a stream of live updates does), and change the deal 200 ms in.
    await p.evaluate(() => { window.__burst = setInterval(() => pullSync(), 150); setTimeout(() => { deal(1).value = 2500; save(); }, 200); setTimeout(() => clearInterval(window.__burst), 4000); });
    await sleep(2400);
    const d = ((await req('GET', '/sync?since=0', { cookie: c })).body.records || []).find((r) => r.col === 'deals' && r.id === '1').data;
    t('the edit reached the server within about two seconds despite constant pulls', d.value === 2500, d.value);
    await sleep(2000);
    t('typing-style changes are still batched: several quick saves send one request', await p.evaluate(async () => { let n = 0; const orig = window.fetch; window.fetch = (u, o) => { if (/api\/v1\/sync/.test(u) && o && o.method === 'POST') n++; return orig(u, o); }; for (let i = 0; i < 5; i++) { deal(1).value = 3000 + i; save(); await new Promise((r) => setTimeout(r, 40)); } await new Promise((r) => setTimeout(r, 1200)); window.fetch = orig; return n === 1; }));
    t('no page errors', errs.length === 0, errs);
  } finally { await b.close(); srv.kill('SIGTERM'); }
})().catch((e) => { console.error(e); process.exit(1); });
