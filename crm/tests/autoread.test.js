// Notifications mark themselves read when the person is looking at what they point to.
const { chromium } = require('playwright-core');
const fs = require('node:fs'), http = require('node:http');
const ROOT = require('node:path').resolve(__dirname, '..') + '';
const t = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) process.exitCode = 1; };
(async () => {
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fs.readFileSync(ROOT + '/wireframe.html', 'utf8')}</body></html>`;
  const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(html); }).listen(3291);
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } }); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://127.0.0.1:3291/', { waitUntil: 'load' });
  const go = (h) => p.evaluate((h) => { location.hash = h; route(); }, h);
  const unread = () => p.evaluate(() => S.notifs.filter((n) => !n.read && n.to && n.to.includes('u1')).map((n) => n.id).sort());
  await p.evaluate(() => { NET.mode = 'local'; S.loggedIn = true; S.me = 'u1'; S.notifs.forEach((n) => { n.read = true; });
    S.notifs.unshift(
      { id: 101, text: 'Jordan sent you a message', p: '', at: 'now', read: false, go: '#/chat/dm_u1_u3', to: ['u1'] },
      { id: 102, text: 'Sam mentioned you', p: '', at: 'now', read: false, go: '#/chat', to: ['u1'] },
      { id: 103, text: 'Task assigned: Send the scope', p: '', at: 'now', read: false, go: '#/tasks', to: ['u1'] },
      { id: 104, text: 'Lead assigned: Harbourline', p: '', at: 'now', read: false, go: '#/deal/1', to: ['u1'] },
      { id: 105, text: 'A client replied', p: '', at: 'now', read: false, go: '#/email', to: ['u1'] },
      { id: 106, text: 'For Sam only', p: '', at: 'now', read: false, go: '#/tasks', to: ['u2'] });
    S.ui.room = 'general'; location.hash = '#/dashboard'; route(); });
  t('dashboard: nothing marked (5 unread)', (await unread()).join() === '101,102,103,104,105');
  await go('#/chat');
  t('chat in #general: the plain #/chat mention clears, the DM alert stays', (await unread()).join() === '101,103,104,105');
  await p.evaluate(() => { S.ui.room = 'dm_u1_u3'; route(); });
  t('switching to the DM with Jordan clears its alert', (await unread()).join() === '103,104,105');
  await go('#/deal/2');
  t('another deal does not clear the deal 1 alert', (await unread()).join() === '103,104,105');
  await go('#/deal/1');
  t('opening deal 1 clears it', (await unread()).join() === '103,105');
  await go('#/tasks');
  t('task list clears the task alert, but not Sam\'s', (await unread()).join() === '105' && await p.evaluate(() => !S.notifs.find((n) => n.id === 106).read));
  await go('#/email');
  t('Email clears the reply alert; bell empty, title plain', (await unread()).join() === '' && await p.evaluate(() => document.querySelector('#notif-pip').hidden && document.title === 'Acme CRM'));
  // Live arrival for the room you are already reading: marked on the re-render, and announce() shows nothing.
  await p.evaluate(() => { S.ui.room = 'dm_u1_u3'; location.hash = '#/chat'; route(); });
  await p.evaluate(() => { const n = { id: 107, text: 'Jordan sent you a message', p: 'again', at: 'now', read: false, go: '#/chat/dm_u1_u3', to: ['u1'] }; S.notifs.unshift(n); route(); announce([n]); });
  await p.waitForTimeout(150);
  t('an alert for the open room is read at once and no card appears', await p.evaluate(() => S.notifs.find((n) => n.id === 107).read && !document.querySelector('.toast.notice') && !document.querySelector('#notif-btn').classList.contains('ring')));
  await p.evaluate(() => { S.ui.room = 'general'; route(); const n = { id: 108, text: 'Jordan sent you a message', p: 'third', at: 'now', read: false, go: '#/chat/dm_u1_u3', to: ['u1'] }; S.notifs.unshift(n); route(); announce([n]); });
  await p.waitForTimeout(150);
  t('an alert for another room still pops up', await p.evaluate(() => !S.notifs.find((n) => n.id === 108).read && !!document.querySelector('.toast.notice')));
  t('no page errors', errs.filter((e) => !/reading 'users'/.test(e)).length === 0);
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
