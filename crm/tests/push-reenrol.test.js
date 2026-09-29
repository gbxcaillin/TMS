// After sign-in the app re-enrols a device whose push subscription was lost (reinstall, cleared data), and nags once
// per session when the browser permission is gone too.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');
const ROOT = require('node:path').resolve(__dirname, '..') + '';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'push-resub-'));
const PORT = 3993; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) process.exitCode = 1; };
const req = (method, p, { body, cookie } = {}) => new Promise((resolve, reject) => { const data = body ? Buffer.from(JSON.stringify(body)) : null; const r = http.request({ host: '127.0.0.1', port: PORT, method, path: '/api/v1' + p, headers: { 'x-requested-with': 'brightday', ...(cookie ? { cookie } : {}), ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } }, (res) => { let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(s || '{}') })); }); r.on('error', reject); if (data) r.write(data); r.end(); });
// Fake the browser side: permission state and a push manager whose subscription can be present or missing.
const fakeBrowser = (permission, hasSub) => `(() => {
  window.__calls = [];
  const sub = { endpoint: 'https://push.example/dev/abcdefghijklmnopqrstuvwxyz', expirationTime: null, toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'x', auth: 'y' } }; }, unsubscribe: async () => true };
  let current = ${hasSub} ? sub : null;
  const pm = { getSubscription: async () => { window.__calls.push('get'); return current; }, subscribe: async () => { window.__calls.push('subscribe'); current = sub; return sub; } };
  const reg = { pushManager: pm, showNotification: async () => {}, active: {} };
  Object.defineProperty(navigator, 'serviceWorker', { value: { getRegistration: async () => reg, register: async () => reg, addEventListener() {}, ready: Promise.resolve(reg) }, configurable: true });
  window.Notification = { permission: '${permission}', requestPermission: async () => '${permission}' };
  window.__toasts = []; new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent); }))).observe(document, { childList: true, subtree: true });
})()`;
(async () => {
  process.env.DATA_DIR = DATA; process.env.ALLOW_UNENCRYPTED = '1';
  const D = require(ROOT + '/server/lib/db'); const auth = require(ROOT + '/server/lib/auth');
  D.users.insert({ id: 'u2', email: 'sam@x.com', name: 'Sam Rivera', role: 'Admin', status: 'Active', color: '#F50D74', pw_hash: auth.hashPassword('pw-1234567890') });
  D.kvSet('settings', { notifyPrefs: { events: [] }, security: { mfaRequired: 'none' } }); // an initialised workspace (a manager cannot set one up)
  D.db.close();
  const srv = spawn('node', ['index.js'], { cwd: ROOT + '/server', env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), ALLOW_UNENCRYPTED: '1', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (c) => (log += c)); srv.stderr.on('data', (c) => (log += c));
  for (let i = 0; i < 50 && !/\[boot\] /.test(log); i++) await sleep(100);
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
  try {
    const c = (await req('POST', '/auth/login', { body: { email: 'sam@x.com', password: 'pw-1234567890' } })).headers['set-cookie'][0].split(';')[0];
    const open = async (permission, hasSub) => { const ctx = await b.newContext(); await ctx.addCookies([{ name: c.split('=')[0], value: c.split('=')[1], domain: '127.0.0.1', path: '/' }]); const p = await ctx.newPage(); await p.addInitScript(fakeBrowser(permission, hasSub)); await p.goto(`http://127.0.0.1:${PORT}/#/dashboard`, { waitUntil: 'load' }); await p.waitForFunction(() => typeof S === 'object' && S && S.loggedIn && !NET.dirty, null, { timeout: 10000 }); await sleep(900); return { p, ctx }; };
    // 1. First sign-in on a fresh device with permission granted but no subscription (what a reinstall looks like).
    let { p, ctx } = await open('granted', false);
    const a = await p.evaluate(() => ({ calls: window.__calls, devices: S.settings.push.devices.map((d) => d.user + ':' + d.endpoint), enabled: S.settings.push.enabled }));
    t('reinstall: app subscribes again and enrols the device on the server (' + a.calls.join(',') + ')', a.calls.join(',') === 'get,subscribe' && a.devices.includes('u2:cdefghijklmnopqrstuvwxyz') && a.enabled === true);
    const status = await req('GET', '/sync?since=0', { cookie: c });
    const rows = (() => { const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(path.join(DATA, 'crm.db'), { readOnly: true }); const r = db.prepare("SELECT user_id, endpoint FROM push_subs").all(); db.close(); return r; })();
    t('server holds the device subscription (' + rows.length + ' row)', rows.length === 1 && rows[0].user_id === 'u2' && /abcdefghijklmnopqrstuvwxyz$/.test(rows[0].endpoint));
    await ctx.close();
    // 2. Next sign-in with the subscription present: no re-enrolment needed.
    ({ p, ctx } = await open('granted', true));
    const b2 = await p.evaluate(() => ({ calls: window.__calls, n: S.settings.push.devices.filter((d) => d.user === 'u2').length }));
    t('already enrolled: checks only, no duplicate device (' + b2.calls.join(',') + ', ' + b2.n + ' device)', b2.calls.join(',') === 'get' && b2.n === 1);
    await ctx.close();
    // 3. Permission gone as well (site data cleared): no subscribe attempt, one message per session.
    {
      const ctx3 = await b.newContext(); await ctx3.addCookies([{ name: c.split('=')[0], value: c.split('=')[1], domain: '127.0.0.1', path: '/' }]); const p3 = await ctx3.newPage(); await p3.addInitScript(fakeBrowser('default', false));
      await p3.goto(`http://127.0.0.1:${PORT}/#/dashboard`, { waitUntil: 'domcontentloaded' });
      await p3.waitForFunction(() => typeof S === 'object' && S && S.loggedIn && sessionStorage.getItem('brightday-push-nag') === '1', null, { timeout: 10000 });
      const st3 = await p3.evaluate(() => ({ calls: window.__calls, had: (S.settings.push.devices || []).some((d) => d.user === S.me) }));
      t('permission lost: no subscribe attempt, the session is marked as told (' + st3.calls.join(',') + ')', st3.calls.join(',') === 'get' && st3.had);
      // The message itself: clear the session mark and run the check again with toast() observed.
      const shown = await p3.evaluate(async () => { sessionStorage.removeItem('brightday-push-nag'); const seen = []; const o = window.toast; window.toast = (m) => { seen.push(m); o(m); }; await ensurePush(); await ensurePush(); window.toast = o; return seen; });
      t('says push is off on this device, once per session', shown.length === 1 && /Push alerts are off on this device/.test(shown[0]));
      await ctx3.close();
    }
  } finally { await b.close(); srv.kill('SIGTERM'); }
  if (process.exitCode) console.log(log.slice(-1200));
})().catch((e) => { console.error(e); process.exit(1); });
