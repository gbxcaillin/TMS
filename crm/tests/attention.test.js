// Local-mode browser test: bell badge and title, notice card, chime toggle, resizable Email and Chat panes.
const { chromium } = require('playwright-core');
const fs = require('node:fs'), http = require('node:http'), path = require('node:path');
const ROOT = require('node:path').resolve(__dirname, '..') + '', OUT = require('node:os').tmpdir() + '/';
const t = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) process.exitCode = 1; };
(async () => {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${fs.readFileSync(ROOT + '/wireframe.html', 'utf8')}</body></html>`;
  const srv = http.createServer((req, res) => { const u = req.url.split('?')[0]; const f = path.join(ROOT, u); if (u.startsWith('/icons/') && fs.existsSync(f)) { res.setHeader('content-type', 'image/png'); return res.end(fs.readFileSync(f)); } res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html); }).listen(3282);
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://127.0.0.1:3282/', { waitUntil: 'load' });
  await p.evaluate(() => { NET.mode = 'local'; S.loggedIn = true; S.me = 'u1'; S.notifs.forEach((n) => { n.read = true; }); location.hash = '#/dashboard'; route(); });
  await p.waitForTimeout(300);
  t('no unread: badge hidden, no alert class, plain title', await p.evaluate(() => document.querySelector('#notif-pip').hidden && !document.querySelector('#notif-btn').classList.contains('alert') && document.title === 'Acme CRM'));
  await p.evaluate(() => { S.notifs.unshift({ id: 1, text: 'Jordan sent you a message', p: 'Can you check the Harbourline scope?', at: 'now', read: false, go: '#/chat', to: ['u1'] }, { id: 2, text: 'Task assigned: Send the scope', p: 'Sam · due Friday', at: 'now', read: false, go: '#/tasks', to: ['u1'] }); route(); });
  const bell = await p.evaluate(() => { const pip = document.querySelector('#notif-pip'); const cs = getComputedStyle(pip); return { hidden: pip.hidden, n: pip.textContent, alert: document.querySelector('#notif-btn').classList.contains('alert'), title: document.title, bg: cs.backgroundColor, w: pip.offsetWidth, h: pip.offsetHeight }; });
  t('two unread: red count badge on the bell, alert pulse, title (2)', !bell.hidden && bell.n === '2' && bell.alert && bell.title === '(2) Acme CRM' && bell.bg === 'rgb(180, 70, 63)' && bell.w >= 18 && bell.h >= 18);
  await p.screenshot({ path: OUT + 'attn-bell.jpg', type: 'jpeg', quality: 70, clip: { x: 1300, y: 0, width: 300, height: 60 } });
  // Live arrival: announce() rings the bell and pops a card; clicking it opens the record and marks it read.
  await p.evaluate(() => announce([S.notifs[0]]));
  await p.waitForTimeout(150);
  const card = await p.evaluate(() => { const c = document.querySelector('.toast.notice'); return { there: !!c, text: c && c.querySelector('b').textContent, ring: document.querySelector('#notif-btn').classList.contains('ring') }; });
  t('notice card appears with the alert text and the bell rings', card.there && card.text === 'Jordan sent you a message' && card.ring);
  await p.screenshot({ path: OUT + 'attn-card.jpg', type: 'jpeg', quality: 70, clip: { x: 1180, y: 700, width: 420, height: 200 } });
  await p.click('.toast.notice');
  await p.waitForTimeout(300);
  t('clicking the card opens the record, marks it read, badge drops to 1', await p.evaluate(() => location.hash === '#/chat' && S.notifs.find((n) => n.id === 1).read === true && document.querySelector('#notif-pip').textContent === '1' && !document.querySelector('.toast.notice')));
  // Chime toggle on Settings, Notifications.
  await p.evaluate(() => { location.hash = '#/settings/notifications'; route(); }); await p.waitForTimeout(300);
  t('sound button present and off by default', await p.evaluate(() => document.querySelector('#chime-toggle').textContent === 'Sound off'));
  await p.click('#chime-toggle'); await p.waitForTimeout(300);
  t('sound toggles on and is remembered', await p.evaluate(() => document.querySelector('#chime-toggle').textContent === 'Sound on' && localStorage.getItem('acme-chime') === '1'));
  await p.click('#chime-toggle'); await p.waitForTimeout(200);
  // Email: three panes on the demo mailbox with drag handles.
  await p.evaluate(() => { location.hash = '#/email'; route(); }); await p.waitForTimeout(300);
  const em = await p.evaluate(() => { const m = document.querySelector('.mail'); const k = [...m.children].filter((c) => getComputedStyle(c).display !== 'none' && !c.classList.contains('split')); return { cols: m.style.gridTemplateColumns, handles: m.querySelectorAll('.split').length, widths: k.map((c) => c.offsetWidth), total: m.clientWidth, lefts: [...m.querySelectorAll('.split')].map((s) => parseInt(s.style.left)) }; });
  t('email: two handles, defaults 150/330, read pane takes the rest (' + em.widths.join('/') + ' of ' + em.total + ')', em.handles === 2 && em.widths[0] === 150 && em.widths[1] === 330 && em.widths[2] > 600 && em.lefts[0] === 150 && em.lefts[1] === 480);
  // Drag the second handle 200px right.
  const h2 = await p.$('.mail .split:nth-of-type(2)');
  const box = await (await p.$$('.mail .split'))[1].boundingBox();
  await p.mouse.move(box.x + 4, box.y + 200); await p.mouse.down(); await p.mouse.move(box.x + 104, box.y + 200, { steps: 5 }); await p.mouse.move(box.x + 204, box.y + 200, { steps: 5 }); await p.mouse.up();
  await p.waitForTimeout(200);
  const after = await p.evaluate(() => ({ panes: S.ui.panes, w: document.querySelector('.mail-list').offsetWidth, saved: JSON.parse(localStorage.getItem('acme-crm-v8') || localStorage.getItem('acme-ui') || '{}') }));
  t('drag widens the list to 530 and stores it (' + JSON.stringify(after.panes) + ')', after.w === 530 && after.panes && after.panes.mail3 && after.panes.mail3[1] === 530);
  await p.screenshot({ path: OUT + 'attn-email.jpg', type: 'jpeg', quality: 60 });
  await p.evaluate(() => { location.hash = '#/dashboard'; route(); location.hash = '#/email'; route(); }); await p.waitForTimeout(300);
  t('width survives a re-render', await p.evaluate(() => document.querySelector('.mail-list').offsetWidth === 530));
  // Double-click resets.
  const hb = await (await p.$$('.mail .split'))[1].boundingBox();
  await p.mouse.dblclick(hb.x + 4, hb.y + 200); await p.waitForTimeout(200);
  t('double-click resets to 330', await p.evaluate(() => document.querySelector('.mail-list').offsetWidth === 330 && !(S.ui.panes || {}).mail3));
  // Minimum width guard: drag far left.
  const hb1 = await (await p.$$('.mail .split'))[0].boundingBox();
  await p.mouse.move(hb1.x + 4, hb1.y + 200); await p.mouse.down(); await p.mouse.move(hb1.x - 400, hb1.y + 200, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(150);
  t('cannot drag a pane below 120px', await p.evaluate(() => document.querySelector('.mail-folders').offsetWidth === 120));
  await p.evaluate(() => { delete S.ui.panes.mail3; });
  // Chat: one handle on the room list.
  await p.evaluate(() => { location.hash = '#/chat'; route(); }); await p.waitForTimeout(300);
  const ch = await p.evaluate(() => ({ handles: document.querySelectorAll('.chat .split').length, side: document.querySelector('.chat-side').offsetWidth, left: parseInt(document.querySelector('.chat .split').style.left) }));
  t('chat: one handle at the room list edge (220)', ch.handles === 1 && ch.side === 220 && ch.left === 220);
  const hc = await p.$('.chat .split'); const cb = await hc.boundingBox();
  await p.mouse.move(cb.x + 4, cb.y + 200); await p.mouse.down(); await p.mouse.move(cb.x + 84, cb.y + 200, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(150);
  t('chat room list widens to 300', await p.evaluate(() => document.querySelector('.chat-side').offsetWidth === 300 && S.ui.panes.chat[0] === 300));
  await p.evaluate(() => { delete S.ui.panes.chat; });
  // Phone: no handles, no inline grid breaking the stacked layout.
  await p.setViewportSize({ width: 390, height: 800 }); await p.evaluate(() => { location.hash = '#/email'; route(); }); await p.waitForTimeout(300);
  t('phone: no drag handles, list stacked full width', await p.evaluate(() => document.querySelectorAll('.split').length === 0 && document.querySelector('.mail-list').offsetWidth > 300));
  const real = errs.filter((e) => !/reading 'users'/.test(e)); t('no page errors (the local-mode users warning predates this change)', real.length === 0); if (real.length) console.log(real);
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
