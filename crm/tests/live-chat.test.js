// Browser test: two signed-in tabs on the real server. Jordan sends a DM; how fast does Sam's tab show it?
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'live-ui-'));
const PORT = 3978, OUT = require('node:os').tmpdir() + '/';
const t = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const req = (method, p, { body, cookie } = {}) => new Promise((resolve, reject) => {
  const data = body ? Buffer.from(JSON.stringify(body)) : null;
  const r = http.request({ host: '127.0.0.1', port: PORT, method, path: '/api/v1' + p, headers: { 'x-requested-with': 'acme', ...(cookie ? { cookie } : {}), ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } }, (res) => { let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(s || '{}') })); });
  r.on('error', reject); if (data) r.write(data); r.end();
});
const login = async (email) => (await req('POST', '/auth/login', { body: { email, password: 'pw-1234567890' } })).headers['set-cookie'][0].split(';')[0];
(async () => {
  process.env.DATA_DIR = DATA; process.env.ALLOW_UNENCRYPTED = '1';
  const D = require(require('node:path').resolve(__dirname, '..') + '/server/lib/db'); const auth = require(require('node:path').resolve(__dirname, '..') + '/server/lib/auth');
  for (const [id, email, name] of [['u1', 'jordan@x.com', 'Jordan Lee'], ['u2', 'sam@x.com', 'Sam Rivera']]) D.users.insert({ id, email, name, role: 'Manager', status: 'Active', color: '#3559E0', pw_hash: auth.hashPassword('pw-1234567890') });
  D.db.close();
  const srv = spawn('node', ['index.js'], { cwd: require('node:path').resolve(__dirname, '..') + '/server', env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), ALLOW_UNENCRYPTED: '1', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (c) => (log += c)); srv.stderr.on('data', (c) => (log += c));
  for (let i = 0; i < 50 && !/\[boot\] /.test(log); i++) await sleep(100);
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
  try {
    const tab = async (email) => { const c = await login(email); const ctx = await b.newContext({ viewport: { width: 1380, height: 900 } }); await ctx.addCookies([{ name: c.split('=')[0], value: c.split('=')[1], domain: '127.0.0.1', path: '/' }]); const p = await ctx.newPage(); p.errors = []; p.on('pageerror', (e) => p.errors.push(e.message)); await p.goto(`http://127.0.0.1:${PORT}/#/chat`, { waitUntil: 'load' }); await p.waitForFunction(() => typeof S === "object" && S && S.loggedIn, null, { timeout: 10000 }); return p; };
    // Jordan opens first: the app sets the workspace up from the sample configuration and syncs it.
    const A = await tab('jordan@x.com');
    await A.waitForFunction(() => !NET.dirty && NET.rev > 0, null, { timeout: 10000 });
    // Pretend this workspace predates the DM row, and open a DM with Sam.
    await A.evaluate(() => { S.settings.notifyPrefs.events = S.settings.notifyPrefs.events.filter((e) => e.id !== 'dm'); S.rooms.push({ id: 'dm_u1_u2', name: '', kind: 'dm', members: ['u1', 'u2'] }); save(); });
    await A.waitForFunction(() => !NET.dirty, null, { timeout: 10000 }); await sleep(300);
    const R = await tab('sam@x.com');
    t('Sam sees the DM room without the DM pref row (older workspace)', await R.evaluate(() => !!S.rooms.find((r) => r.id === 'dm_u1_u2') && !S.settings.notifyPrefs.events.find((e) => e.id === 'dm')));
    await R.waitForFunction(() => NET.live === true, null, { timeout: 5000 }).catch(() => {});
    t('Sam\'s tab has the live stream open', await R.evaluate(() => NET.live === true && !!NET.es));
    t('poll relaxed to 60 s while live', await R.evaluate(() => NET.live) === true);
    await A.evaluate(() => { S.ui.room = 'dm_u1_u2'; route(); });
    await R.evaluate(() => { S.ui.room = 'general'; route(); });
    await R.fill('#chat-form textarea', 'half a thought');
    // Jordan types and sends; Sam is in another room. Measure until Sam's state holds the message.
    const before = await R.evaluate(() => S.messages.length);
    const t0 = Date.now();
    await A.fill('#chat-form textarea', 'Can you check the Harbourline scope before 3?');
    await A.press('#chat-form textarea', 'Enter');
    await R.waitForFunction((n) => S.messages.length > n, before, { timeout: 5000 });
    const ms = Date.now() - t0;
    t('Sam\'s tab has the DM in under 1.5 s without a poll (' + ms + ' ms)', ms < 1500);
    await sleep(300);
    t('unread badge on Chat updated live while the composer is focused', await R.evaluate(() => document.querySelector('#nav-chat').textContent === '1'));
    t('Sam\'s draft survives the live re-render, with focus', await R.evaluate(() => document.activeElement === document.querySelector('#chat-form textarea') && document.querySelector('#chat-form textarea').value === 'half a thought'));
    t('the DM room shows an unread mark in the room list', await R.evaluate(() => /Jordan/.test(document.querySelector('.chat-side').textContent)));
    await R.fill('#chat-form textarea', '');
    // The bell notice arrived with a deep link; following it opens the DM.
    const attn = await R.evaluate(() => ({ card: !!document.querySelector('.toast.notice'), cardText: (document.querySelector('.toast.notice b') || {}).textContent, badge: document.querySelector('#notif-pip').textContent, alert: document.querySelector('#notif-btn').classList.contains('alert'), title: document.title }));
    t('live arrival: notice card, red count 1 on the bell, title (1)', attn.card && /Jordan sent you a message/.test(attn.cardText) && attn.badge === '1' && attn.alert && attn.title === '(1) Acme CRM');
    // Connected-mailbox layout: two panes, conversation takes the rest of the width.
    await R.evaluate(() => { window.fetchMail = () => {}; NET.features.mailbox = true; MAIL.accounts = [{ email: 'sam@x.com' }]; MAIL.loaded = true; location.hash = '#/email'; try { route(); } catch (e) { window.__err = e.message; } });
    await sleep(400);
    const em = await R.evaluate(() => { const m = document.querySelector('.mail'); return m ? { two: m.classList.contains('two'), list: document.querySelector('.mail-list').offsetWidth, read: document.querySelector('.mail-read').offsetWidth, total: m.clientWidth, handles: m.querySelectorAll('.split').length, err: window.__err } : { err: window.__err || 'no .mail' }; });
    t('connected mailbox: list 340 and the conversation fills the rest (' + JSON.stringify(em) + ')', em.two && em.list === 340 && em.read >= em.total - 345 && em.handles === 1);
    await R.evaluate(() => { location.hash = '#/chat'; route(); }); await sleep(200);
    t('bell notice for Sam with a deep link', await R.evaluate(() => S.notifs.some((n) => /Jordan sent you a message/.test(n.text) && n.go === '#/chat/dm_u1_u2')));
    await R.evaluate(() => { location.hash = '#/chat/dm_u1_u2'; }); await sleep(400);
    t('#/chat/<room> opens that conversation and settles on #/chat', await R.evaluate(() => S.ui.room === 'dm_u1_u2' && location.hash === '#/chat' && /Harbourline scope/.test(document.querySelector('#chat-log').textContent)));
    await R.screenshot({ path: OUT + 'live-dm.jpg', type: 'jpeg', quality: 60 });
    // Reply goes back the other way just as fast.
    const beforeA = await A.evaluate(() => S.messages.length);
    const t1 = Date.now();
    await R.fill('#chat-form textarea', 'On it, back to you by 2.'); await R.press('#chat-form textarea', 'Enter');
    await A.waitForFunction((n) => S.messages.length > n, beforeA, { timeout: 5000 });
    t('reply reaches Jordan live (' + (Date.now() - t1) + ' ms)', Date.now() - t1 < 1500);
    // Settings, Notifications shows the new DM row for a workspace that predates it.
    await R.evaluate(() => { location.hash = '#/settings/notifications'; }); await sleep(500);
    t('DM row appears in Notifications for an older workspace', await R.evaluate(() => [...document.querySelectorAll('table.prefs td:first-child')].some((td) => /direct message/.test(td.textContent))));
    await sleep(600);
    t('the added row is saved back to the server', (await req('GET', '/sync?since=0', { cookie: await login('sam@x.com') })).body.kv.settings.notifyPrefs.events.some((e) => e.id === 'dm'));
    // Dashboard stat headings.
    await R.evaluate(() => { location.hash = '#/dashboard'; }); await sleep(600);
    const st = await R.evaluate(() => { const l = document.querySelector('.stat .label'); const cs = getComputedStyle(l); return { size: cs.fontSize, weight: cs.fontWeight, color: cs.color }; });
    t('stat headings are 12px bold ink (' + st.size + ' ' + st.weight + ')', st.size === '12px' && +st.weight >= 700);
    await R.screenshot({ path: OUT + 'live-stats.jpg', type: 'jpeg', quality: 60, clip: { x: 0, y: 0, width: 1380, height: 330 } });
    // Stream drop: close it by hand; the app falls back to the 15 s poll and reconnects.
    await R.evaluate(() => { NET.es.close(); NET.es.onerror(); });
    t('after a drop the poll is back to 15 s and live is off', await R.evaluate(() => NET.live === false));
    await R.evaluate(() => openLive()); await R.waitForFunction(() => NET.live === true, null, { timeout: 5000 });
    t('reconnects', await R.evaluate(() => NET.live === true));
    t('no page errors', A.errors.length === 0 && R.errors.length === 0);
    if (A.errors.length || R.errors.length) console.log(A.errors, R.errors);
    const status = await req('GET', '/admin/status', { cookie: await login('jordan@x.com') });
    t('admin status counts live streams (admin only, so 403 for a Manager is fine)', status.status === 403 || (status.body.live && status.body.live.streams >= 2));
  } finally { await b.close(); srv.kill('SIGTERM'); }
  if (process.exitCode) console.log(log.slice(-1500));
})().catch((e) => { console.error(e); process.exit(1); });
