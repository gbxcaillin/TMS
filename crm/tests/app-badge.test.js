// App icon badge: the page sets the badge to the unread count and clears it at zero; push payloads carry the count.
const { chromium } = require('playwright-core');
const fs = require('node:fs'), http = require('node:http'), os = require('node:os'), path = require('node:path');
const ROOT = require('node:path').resolve(__dirname, '..') + '';
const t = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) process.exitCode = 1; };
(async () => {
  // 1. Page side, with the badging API stubbed to record calls.
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fs.readFileSync(ROOT + '/wireframe.html', 'utf8')}</body></html>`;
  const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(html); }).listen(3290);
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
  const p = await b.newPage();
  await p.addInitScript(() => { window.__badge = []; navigator.setAppBadge = (n) => { window.__badge.push('set:' + n); return Promise.resolve(); }; navigator.clearAppBadge = () => { window.__badge.push('clear'); return Promise.resolve(); }; });
  await p.goto('http://127.0.0.1:3290/', { waitUntil: 'load' });
  await p.evaluate(() => { NET.mode = 'local'; S.loggedIn = true; S.me = 'u1'; S.notifs.forEach((n) => { n.read = true; }); window.__badge = []; location.hash = '#/dashboard'; route(); });
  t('all read: badge cleared', await p.evaluate(() => window.__badge[0] === 'clear'));
  await p.evaluate(() => { S.notifs.unshift({ id: 1, text: 'a', p: '', at: 'now', read: false, go: '#/tasks', to: ['u1'] }, { id: 2, text: 'b', p: '', at: 'now', read: false, go: '#/tasks', to: ['u1'] }, { id: 3, text: 'c', p: '', at: 'now', read: false, go: '#/tasks', to: ['u2'] }); window.__badge = []; route(); });
  t('two unread for me (one for someone else ignored): badge set to 2', await p.evaluate(() => window.__badge.pop() === 'set:2'));
  await p.evaluate(() => { S.notifs.find((n) => n.id === 1).read = true; window.__badge = []; route(); });
  t('one read: badge set to 1', await p.evaluate(() => window.__badge.pop() === 'set:1'));
  await p.evaluate(() => { S.notifs.forEach((n) => { n.read = true; }); window.__badge = []; route(); });
  t('everything read again: cleared', await p.evaluate(() => window.__badge.pop() === 'clear'));
  await b.close(); srv.close();
  // 2. Service worker push handler sets the badge from the payload.
  const swSrc = fs.readFileSync(ROOT + '/sw.js', 'utf8');
  const calls = []; const listeners = {};
  const sandbox = { self: { addEventListener: (k, f) => { listeners[k] = f; }, registration: { showNotification: async () => {} }, navigator: { setAppBadge: async (n) => calls.push('set:' + n), clearAppBadge: async () => calls.push('clear') }, clients: {}, location: { href: 'https://crm.example.com/sw.js' }, skipWaiting: () => {} }, caches: { open: async () => ({ addAll: async () => {} }), keys: async () => [] }, fetch: async () => {}, URL, Date, Promise, console };
  sandbox.self.addEventListener.bind(sandbox.self);
  new Function('self', 'caches', 'fetch', 'URL', 'Date', 'Promise', 'console', 'navigator', swSrc)(sandbox.self, sandbox.caches, sandbox.fetch, URL, Date, Promise, console, sandbox.self.navigator);
  const fire = async (data) => { const waits = []; await listeners.push({ data: { json: () => data }, waitUntil: (pr) => waits.push(pr) }); await Promise.all(waits); };
  await fire({ title: 'x', badge: 3 }); await fire({ title: 'y', badge: 0 }); await fire({ title: 'z' });
  t('worker: badge 3 sets, 0 clears, absent leaves it alone (' + calls.join(',') + ')', calls.join(',') === 'set:3,clear');
  // 3. Server: push payloads carry the recipient's unread count.
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'badge-')); process.env.ALLOW_UNENCRYPTED = '1';
  const push = require(ROOT + '/server/lib/push'); const sent = []; push.sendToUser = async (uid, payload) => { sent.push({ uid, badge: payload.badge }); return 1; };
  const D = require(ROOT + '/server/lib/db'); const notify = require(ROOT + '/server/lib/notify');
  D.users.insert({ id: 'u1', email: 'a@x.com', name: 'Jordan T', role: 'Manager', status: 'Active', color: '#000' });
  D.users.insert({ id: 'u2', email: 'b@x.com', name: 'Sam S', role: 'Manager', status: 'Active', color: '#000' });
  D.kvSet('settings', { notifyPrefs: { events: [], quietFrom: '', quietTo: '' } });
  D.putRecord('rooms', { id: 'dm_u1_u2', name: '', kind: 'dm', members: ['u1', 'u2'] }, 'u1');
  await notify.onRecordChange('u1', 'messages', null, { id: 1, room: 'dm_u1_u2', who: 'u1', at: '2026-09-28T10:00', text: 'one', read: ['u1'], emailed: [] });
  await notify.onRecordChange('u1', 'messages', null, { id: 2, room: 'dm_u1_u2', who: 'u1', at: '2026-09-28T10:01', text: 'two', read: ['u1'], emailed: [] });
  t('server: first push badge 1, second push badge 2 (' + sent.map((s) => s.badge).join(',') + ')', sent.length === 2 && sent[0].badge === 1 && sent[1].badge === 2 && sent.every((s) => s.uid === 'u2'));
})().catch((e) => { console.error(e); process.exit(1); });
