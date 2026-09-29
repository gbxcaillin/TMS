// Health alerts: a job failing three runs in a row alerts the admins once (not the other staff), a success clears
// it and says so, and an error in someone's browser reaches the server, the audit log and the admins' bell.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');
const ROOT = path.resolve(__dirname, '..'); const PORT = 3972;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = (n, ok, extra) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || extra === undefined ? '' : ' :: ' + JSON.stringify(extra).slice(0, 400))); if (!ok) process.exitCode = 1; };
const req = (method, p, { body, cookie } = {}) => new Promise((resolve, reject) => { const data = body ? Buffer.from(JSON.stringify(body)) : null; const r = http.request({ host: '127.0.0.1', port: PORT, method, path: '/api/v1' + p, headers: { 'x-requested-with': 'brightday', ...(cookie ? { cookie } : {}), ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } }, (res) => { let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => { let b; try { b = JSON.parse(s || '{}'); } catch { b = {}; } resolve({ status: res.statusCode, headers: res.headers, body: b }); }); }); r.on('error', reject); if (data) r.write(data); r.end(); });
(async () => {
  // 1. Job failures, in process.
  const DATA1 = fs.mkdtempSync(path.join(os.tmpdir(), 'health-')); process.env.DATA_DIR = DATA1; process.env.ALLOW_UNENCRYPTED = '1';
  const push = require(ROOT + '/server/lib/push'); const pushed = []; push.sendToUser = async (uid, p) => { pushed.push({ uid, ...p }); return 1; };
  const D = require(ROOT + '/server/lib/db'); const health = require(ROOT + '/server/lib/health'); const auth = require(ROOT + '/server/lib/auth');
  D.users.insert({ id: 'u1', email: 'admin@x.com', name: 'Ada Admin', role: 'Admin', status: 'Active', pw_hash: auth.hashPassword('pw-1234567890') });
  D.users.insert({ id: 'u2', email: 'staff@x.com', name: 'Sam Staff', role: 'Client manager', status: 'Active' });
  D.kvSet('settings', { notifyPrefs: { events: [] }, security: { mfaRequired: 'none' }, research: { starterAt: '2026-01-01T00:00:00', refreshMins: 1440 } });
  const bell = () => D.listCol('notifs').filter((n) => /Price refresh/.test(n.text));
  await health.jobFailed('market', new Error('Yahoo 429')); await health.jobFailed('market', new Error('Yahoo 429'));
  t('two failures: no alert yet', bell().length === 0 && health.jobHealth('market').failures === 2);
  await health.jobFailed('market', new Error('Yahoo 429'));
  t('third failure alerts the admin only, with the error', bell().length === 1 && bell()[0].to.join() === 'u1' && /is failing/.test(bell()[0].text) && /Yahoo 429/.test(bell()[0].p) && pushed.some((p) => p.uid === 'u1'));
  await health.jobFailed('market', new Error('Yahoo 429'));
  t('a fourth failure the same day does not alert again', bell().length === 1 && health.jobHealth('market').failures === 4);
  await health.jobOk('market');
  t('a success clears it and tells the admin it recovered', health.jobHealth('market').failures === 0 && bell().length === 2 && bell().some((n) => /working again/.test(n.text)));
  await health.jobOk('market'); t('further successes are silent', bell().length === 2);
  D.db.close();
  // 2. Browser error on a real server.
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'health2-')); fs.cpSync(DATA1, DATA, { recursive: true });
  const srv = spawn('node', ['index.js'], { cwd: ROOT + '/server', env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), ALLOW_UNENCRYPTED: '1', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (c) => (log += c)); srv.stderr.on('data', (c) => (log += c));
  for (let i = 0; i < 50 && !/\[boot\] /.test(log); i++) await sleep(100);
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
  try {
    const c = (await req('POST', '/auth/login', { body: { email: 'admin@x.com', password: 'pw-1234567890' } })).headers['set-cookie'][0].split(';')[0];
    const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } }); await ctx.addCookies([{ name: c.split('=')[0], value: c.split('=')[1], domain: '127.0.0.1', path: '/' }]);
    const p = await ctx.newPage();
    await p.goto(`http://127.0.0.1:${PORT}/#/integrations`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => typeof S === 'object' && S && S.loggedIn, null, { timeout: 15000 });
    await p.waitForFunction(() => INTEG.jobs, null, { timeout: 10000 }); await sleep(500);
    t('Integrations shows the Background jobs card with the price refresh row', /Background jobs/.test(await p.innerText('#content')) && /Price refresh/.test(await p.innerText('#content')));
    // Break a page on purpose: the dashboard view throws.
    await p.evaluate(() => { window.__orig = vDashboard; vDashboard = () => { throw new Error('Test render failure 42'); }; location.hash = '#/dashboard'; });
    await sleep(1500);
    t('the page shows the error card', /hit a problem while drawing/.test(await p.innerText('#content')));
    const sync = (await req('GET', '/sync?since=0', { cookie: c })).body.records || [];
    const alert = sync.find((r) => r.col === 'notifs' && r.data && /App error for Ada Admin: Test render failure 42/.test(r.data.text));
    t('the error reached the server and the admins\' bell', !!alert, sync.filter((r) => r.col === 'notifs').map((r) => r.data && r.data.text));
    t('it is in the server log with the page', /\[client error\].*#\/dashboard.*Test render failure 42/.test(log));
    await p.evaluate(() => { location.hash = '#/tasks'; }); await sleep(300); await p.evaluate(() => { location.hash = '#/dashboard'; }); await sleep(1000);
    const again = ((await req('GET', '/sync?since=0', { cookie: c })).body.records || []).filter((r) => r.col === 'notifs' && r.data && /Test render failure/.test(r.data.text));
    t('the same error again does not send a second alert', again.length === 1);
    const r = await req('POST', '/client-error', { body: { message: 'x' } }); t('signed-out reports are refused', r.status === 401);
  } finally { await b.close(); srv.kill('SIGTERM'); }
})().catch((e) => { console.error(e); process.exit(1); });
