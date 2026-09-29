// An older workspace (set up before Research existed) has stages, sources, fields, colors and settings on the
// server but no watchlist, campaigns or spend documents. Research and Reports must still open, and the missing
// documents are written back on the next save.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');
const ROOT = require('node:path').resolve(__dirname, '..') + '';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'research-old-'));
const PORT = 3988; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) process.exitCode = 1; };
const req = (method, p, { body, cookie } = {}) => new Promise((resolve, reject) => { const data = body ? Buffer.from(JSON.stringify(body)) : null; const r = http.request({ host: '127.0.0.1', port: PORT, method, path: '/api/v1' + p, headers: { 'x-requested-with': 'brightday', ...(cookie ? { cookie } : {}), ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } }, (res) => { let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(s || '{}') })); }); r.on('error', reject); if (data) r.write(data); r.end(); });
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
  // The sample configuration, read from the app itself.
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fs.readFileSync(ROOT + '/wireframe.html', 'utf8')}</body></html>`;
  const stat = http.createServer((q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(html); }).listen(3989);
  const p0 = await b.newPage(); await p0.goto('http://127.0.0.1:3989/', { waitUntil: 'load' });
  const seed = await p0.evaluate(() => JSON.parse(JSON.stringify({ stages: SEED.stages, sources: SEED.sources, fields: SEED.fields, colors: SEED.colors, settings: SEED.settings })));
  await p0.close(); stat.close();
  process.env.DATA_DIR = DATA; process.env.ALLOW_UNENCRYPTED = '1';
  const D = require(ROOT + '/server/lib/db'); const auth = require(ROOT + '/server/lib/auth');
  D.users.insert({ id: 'u1', email: 'cc@x.com', name: 'Alex Morgan', role: 'Manager', status: 'Active', color: '#F50D74', pw_hash: auth.hashPassword('pw-1234567890') });
  seed.settings.apiKeys = []; seed.settings.push = { enabled: false, devices: [] }; delete seed.settings.research; delete seed.settings.invoice; delete seed.settings.claudeTriggers; // sections added after this workspace was set up seed.settings.security = { ...(seed.settings.security || {}), mfaRequired: 'none' };
  for (const k of ['stages', 'sources', 'fields', 'colors', 'settings']) D.kvSet(k, seed[k]);
  D.db.close();
  const srv = spawn('node', ['index.js'], { cwd: ROOT + '/server', env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), ALLOW_UNENCRYPTED: '1', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (c) => (log += c)); srv.stderr.on('data', (c) => (log += c));
  for (let i = 0; i < 50 && !/\[boot\] /.test(log); i++) await sleep(100);
  try {
    const c = (await req('POST', '/auth/login', { body: { email: 'cc@x.com', password: 'pw-1234567890' } })).headers['set-cookie'][0].split(';')[0];
    const kv0 = (await req('GET', '/sync?since=0', { cookie: c })).body.kv;
    t('older workspace: settings present, no watchlist, campaigns or spend', !!kv0.settings && !('watchlist' in kv0) && !('campaigns' in kv0) && !('spend' in kv0));
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } }); await ctx.addCookies([{ name: c.split('=')[0], value: c.split('=')[1], domain: '127.0.0.1', path: '/' }]);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.addInitScript(() => addEventListener('unhandledrejection', (e) => console.error('UNHANDLED ' + (e.reason && (e.reason.stack || e.reason.message)))));
    p.on('console', (m) => { if (/UNHANDLED/.test(m.text())) errs.push(m.text().slice(0, 300)); });
    await p.goto(`http://127.0.0.1:${PORT}/#/research`, { waitUntil: 'load' });
    await p.waitForFunction(() => typeof S === 'object' && S && S.loggedIn, null, { timeout: 10000 }); await sleep(800);
    const r = await p.evaluate(() => ({ h1: (document.querySelector('.page-head h1') || {}).textContent, wl: Array.isArray(S.watchlist), camp: !!S.campaigns && typeof S.campaigns === 'object', spend: !!S.spend && typeof S.spend === 'object', len: document.querySelector('#content').innerHTML.length, toasts: [...document.querySelectorAll('.toast')].map((x) => x.textContent) }));
    t('Research renders with an empty watchlist (' + r.h1 + ')', /research/i.test(r.h1 || '') && r.wl && r.camp && r.spend && r.len > 1000);
    t('missing settings sections are filled in (research, invoice, Claude triggers)', await p.evaluate(() => !!S.settings.research && S.settings.research.provider && !!S.settings.invoice && !!S.settings.claudeTriggers));
    await p.evaluate(() => { location.hash = '#/settings/research'; }); await sleep(500);
    t('Settings, Research data renders', await p.evaluate(() => /provider|Yahoo/i.test(document.querySelector('#content').innerText)) && errs.length === 0);
    await p.evaluate(() => { location.hash = '#/invoices'; }); await sleep(500);
    t('Invoices renders', await p.evaluate(() => location.hash === '#/invoices' && document.querySelector('#content').innerHTML.length > 1000) && errs.length === 0);
    // A page that throws shows the error instead of leaving the old page up.
    await p.evaluate(() => { window.__realResearch = vResearch; window.vResearch = () => { throw new Error('boom from a test'); }; location.hash = '#/research'; route(); });
    t('a failing page shows the error card with the message', await p.evaluate(() => /hit a problem/.test(document.querySelector('#content').innerText) && /boom from a test/.test(document.querySelector('#content').innerText)));
    await p.evaluate(() => { window.vResearch = window.__realResearch; route(); });
    t('it is treated as an existing workspace, not a new one', !r.toasts.some((x) => /Workspace created/.test(x)));
    t('no page errors', errs.length === 0); if (errs.length) console.log(errs);
    await p.evaluate(() => { location.hash = '#/reports'; }); await sleep(600);
    const rep = await p.evaluate(() => ({ hash: location.hash, len: document.querySelector('#content').innerHTML.length }));
    t('Reports renders', rep.hash === '#/reports' && rep.len > 1000 && errs.length === 0); if (errs.length) console.log(errs);
    await p.waitForFunction(() => !NET.dirty && !NET.busy, null, { timeout: 5000 }); await sleep(300);
    const kv = (await req('GET', '/sync?since=0', { cookie: c })).body.kv;
    t('watchlist, campaigns and spend are written back to the server', Array.isArray(kv.watchlist) && !!kv.campaigns && typeof kv.campaigns === 'object' && !!kv.spend && typeof kv.spend === 'object');
    t('existing documents untouched (stages still ' + (kv0.stages || []).length + ')', JSON.stringify(kv.stages) === JSON.stringify(kv0.stages) && JSON.stringify(kv.fields) === JSON.stringify(kv0.fields));
  } finally { await b.close(); srv.kill('SIGTERM'); }
  if (process.exitCode) console.log(log.slice(-1200));
})().catch((e) => { console.error(e); process.exit(1); });
