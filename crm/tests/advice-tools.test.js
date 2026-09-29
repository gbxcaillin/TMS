// Advice tools: the CRM hands over to the tools service mounted beside it (/tools/) and lets it share the sign-in.
// Server: /auth/me answers who is signed in and what they may use (401 signed out, the "tools" permission follows
// the access level), and bootstrap tells the app where the tools live. App: the menu shows Advice tools to levels
// that have it, hides it from Basic, and #/tools renders its hand-over page without errors.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');
const ROOT = path.resolve(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-e2e-'));
const PORT = 3981;
const t = (n, ok, extra) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || extra === undefined ? '' : ' :: ' + JSON.stringify(extra).slice(0, 300))); if (!ok) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const req = (method, p, { body, cookie } = {}) => new Promise((resolve, reject) => {
  const data = body ? Buffer.from(JSON.stringify(body)) : null;
  const r = http.request({ host: '127.0.0.1', port: PORT, method, path: '/api/v1' + p, headers: { 'x-requested-with': 'brightday', ...(cookie ? { cookie } : {}), ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } }, (res) => {
    let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(s); } catch (_) { } resolve({ status: res.statusCode, headers: res.headers, body: j }); });
  });
  r.on('error', reject); if (data) r.write(data); r.end();
});
const login = async (email) => { const r = await req('POST', '/auth/login', { body: { email, password: 'pw-1234567890' } }); return (r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; '); };

(async () => {
  process.env.DATA_DIR = DATA; process.env.ALLOW_UNENCRYPTED = '1';
  const D = require(ROOT + '/server/lib/db'); const auth = require(ROOT + '/server/lib/auth');
  for (const [id, email, name, role] of [['u1', 'para@x.com', 'Sam Rivera', 'Paraplanner'], ['u2', 'basic@x.com', 'Jordan Lee', 'Basic']]) D.users.insert({ id, email, name, role, status: 'Active', color: '#F50D74', pw_hash: auth.hashPassword('pw-1234567890') });
  D.kvSet('settings', { notifyPrefs: { events: [], quietFrom: '', quietTo: '' }, security: { mfaRequired: 'none' } });
  D.db.close();
  const srv = spawn('node', ['index.js'], { cwd: ROOT + '/server', env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), ALLOW_UNENCRYPTED: '1', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (c) => (log += c)); srv.stderr.on('data', (c) => (log += c));
  for (let i = 0; i < 50 && !/\[boot\] /.test(log); i++) await sleep(100);
  try {
    t('server booted', /\[boot\] /.test(log), log.slice(-400));
    const anon = await req('GET', '/auth/me');
    t('auth/me is 401 when signed out', anon.status === 401);
    const para = await login('para@x.com'), basic = await login('basic@x.com');
    const me = await req('GET', '/auth/me', { cookie: para });
    t('auth/me names the signed-in user', me.status === 200 && me.body.user && me.body.user.email === 'para@x.com' && me.body.user.role === 'Paraplanner' && !('pw_hash' in me.body.user), me.body);
    t('a paraplanner may use the advice tools', me.body.perms && me.body.perms.tools === true);
    const me2 = await req('GET', '/auth/me', { cookie: basic });
    t('Basic does not get the advice tools by default', me2.status === 200 && me2.body.perms.tools === false);
    const boot = await req('GET', '/bootstrap', { cookie: para });
    t('bootstrap says where the tools live', boot.body.features && boot.body.features.tools === '/tools/');
  } finally { srv.kill(); fs.rmSync(DATA, { recursive: true, force: true }); }

  // The service worker leaves /tools/ alone: it must not answer it from cache or store it as this app's shell.
  {
    const vm = require('node:vm'); const listeners = {}; const handled = [];
    const self = { addEventListener: (ev, fn) => (listeners[ev] = fn), location: { origin: 'https://portal.test' }, skipWaiting() {}, clients: { claim() {} }, registration: {} };
    vm.runInNewContext(fs.readFileSync(ROOT + '/sw.js', 'utf8'), { self, caches: { match: async () => null, open: async () => ({ put() {} }) }, Response: { error: () => null }, fetch: () => Promise.reject(new Error('no network')), URL, console, Promise, setTimeout });
    const fire = (url) => listeners.fetch({ request: { method: 'GET', url, mode: 'navigate' }, respondWith: () => handled.push(url) });
    fire('https://portal.test/tools/'); fire('https://portal.test/tools/runs/abc'); fire('https://portal.test/');
    t('the service worker passes /tools/ straight to the network', handled.length === 1 && handled[0] === 'https://portal.test/', handled);
  }

  // The app: menu entry by access level, and the hand-over page.
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fs.readFileSync(ROOT + '/wireframe.html', 'utf8')}</body></html>`;
  // API calls get a 404 so the page stays in its local demo mode.
  const web = http.createServer((q, s) => { if (q.url.startsWith('/api/')) { s.statusCode = 404; return s.end('{}'); } s.setHeader('content-type', 'text/html'); s.end(html); }).listen(3295);
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
  try {
    const p = await b.newPage({ viewport: { width: 1400, height: 900 } }); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('http://127.0.0.1:3295/', { waitUntil: 'load' });
    await p.evaluate(() => { NET.mode = 'local'; S.loggedIn = true; S.me = 'u1'; location.hash = '#/dashboard'; route(); }); await p.waitForTimeout(300);
    const navShown = () => p.evaluate(() => { const a = document.querySelector('#nav .nav[data-r="tools"]'); return !!a && !a.hidden; });
    t('Advice tools is in the menu for an admin', await navShown());
    await p.evaluate(() => { location.hash = '#/tools'; }); await p.waitForTimeout(300);
    t('#/tools shows the hand-over page with a link to /tools/', await p.evaluate(() => /Advice tools/.test(document.querySelector('#content').textContent) && !!document.querySelector('#content a[href="/tools/"]')));
    await p.evaluate(() => { const me = user(S.me); me.role = 'Basic'; me.perms = null; location.hash = '#/dashboard'; route(); }); await p.waitForTimeout(300);
    t('Basic does not see Advice tools in the menu', !(await navShown()));
    t('no page errors', errs.length === 0, errs);
  } finally { await b.close(); web.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
