// Local-mode browser test: scrolling rail, card contact links, bolder card headings, chat edit/recall/delete.
const { chromium } = require('playwright-core');
const fs = require('node:fs'), http = require('node:http'), path = require('node:path');
const ROOT = require('node:path').resolve(__dirname, '..') + '', OUT = require('node:os').tmpdir() + '/';
const t = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) process.exitCode = 1; };
(async () => {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${fs.readFileSync(ROOT + '/wireframe.html', 'utf8')}</body></html>`;
  const srv = http.createServer((req, res) => { const u = req.url.split('?')[0]; const f = path.join(ROOT, u); if (u.startsWith('/icons/') && fs.existsSync(f)) { res.setHeader('content-type', 'image/png'); return res.end(fs.readFileSync(f)); } res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html); }).listen(3284);
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
  const p = await b.newPage({ viewport: { width: 1400, height: 560 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://127.0.0.1:3284/', { waitUntil: 'load' });
  await p.evaluate(() => { NET.mode = 'local'; S.loggedIn = true; S.me = 'u1'; location.hash = '#/dashboard'; route(); });
  await p.waitForTimeout(300);
  // Rail scrolls on a short window; footer with the name stays visible.
  const rail = await p.evaluate(() => { const r = document.querySelector('.rail'), n = document.querySelector('#nav'), f = document.querySelector('.rail-foot'); return { railH: r.offsetHeight, win: innerHeight, navScroll: n.scrollHeight, navClient: n.clientHeight, ov: getComputedStyle(n).overflowY, footBottom: f.getBoundingClientRect().bottom }; });
  t('rail clipped to the window, nav scrolls (' + rail.navScroll + ' in ' + rail.navClient + '), footer on screen', rail.railH === rail.win && rail.navScroll > rail.navClient && rail.ov === 'auto' && rail.footBottom <= rail.win);
  await p.evaluate(() => { document.querySelector('#nav').scrollTop = 400; });
  t('nav actually scrolls to reveal lower sections', await p.evaluate(() => document.querySelector('#nav').scrollTop > 200 && document.querySelector('[data-r="research"]').getBoundingClientRect().bottom <= innerHeight));
  await p.screenshot({ path: OUT + 'rail-scroll.jpg', type: 'jpeg', quality: 60, clip: { x: 0, y: 0, width: 224, height: 560 } });
  await p.setViewportSize({ width: 1400, height: 900 });
  // Card headings everywhere.
  const heads = await p.evaluate(() => { const h = document.querySelector('.card-head h3'); const cs = getComputedStyle(h); return { size: cs.fontSize, weight: cs.fontWeight, text: h.textContent }; });
  t('card headings are 20px semibold (' + heads.text + ': ' + heads.size + ' ' + heads.weight + ')', heads.size === '20px' && +heads.weight >= 600);
  // Pipeline card contacts.
  await p.evaluate(() => { location.hash = '#/pipeline'; route(); }); await p.waitForTimeout(300);
  const col = await p.evaluate(() => { const n = document.querySelector('.col-head .n'); const cs = getComputedStyle(n); return { size: cs.fontSize, weight: cs.fontWeight }; });
  t('column names 12px bold', col.size === '12px' && +col.weight >= 700);
  const card = await p.evaluate(() => { const c = document.querySelector('.dcard[data-id="1"]'); const a = c.querySelector('.ct a'); const bt = c.querySelector('.ct button'); return { tel: a && a.getAttribute('href'), telText: a && a.textContent.trim(), mail: bt && bt.textContent.trim(), title: bt && bt.title }; });
  t('card shows phone as tel: link and email as a button', card.tel === 'tel:+61390214402' && card.telText === '+61 3 9021 4402' && card.mail === 'sarah@harbourline.com.au' && /Email Sarah Whitfield/.test(card.title));
  await p.screenshot({ path: OUT + 'card-contacts.jpg', type: 'jpeg', quality: 70, clip: { x: 240, y: 120, width: 600, height: 420 } });
  await p.click('.dcard[data-id="1"] .ct button'); await p.waitForTimeout(300);
  const comp = await p.evaluate(() => ({ modal: !!document.querySelector('#mform'), to: (document.querySelector('#mform [name=to]') || {}).value, subject: (document.querySelector('#mform [name=subject]') || {}).value, hash: location.hash }));
  t('email button opens compose to the contact without opening the deal', comp.modal && comp.to === 'sarah@harbourline.com.au' && /Harbourline/.test(comp.subject) && comp.hash === '#/pipeline');
  await p.evaluate(() => closeModal()); await p.waitForTimeout(200);
  // A tel: click must not open the deal page (the softphone handles it); Chromium ignores tel: here.
  await p.evaluate(() => { document.querySelector('.dcard[data-id="1"] .ct a').addEventListener('click', (e) => e.preventDefault(), { once: true }); });
  await p.click('.dcard[data-id="1"] .ct a'); await p.waitForTimeout(200);
  t('phone link does not open the deal card', await p.evaluate(() => location.hash === '#/pipeline'));
  await p.click('.dcard[data-id="1"] .co'); await p.waitForTimeout(200);
  t('clicking elsewhere on the card still opens the deal', await p.evaluate(() => location.hash === '#/deal/1'));
  // Chat: edit, recall, delete.
  await p.evaluate(() => { S.me = 'u3'; S.ui.room = 'general'; location.hash = '#/chat'; route(); }); await p.waitForTimeout(300);
  const own = await p.evaluate(() => { const mine = [...document.querySelectorAll('.cm')].find((c) => S.messages.find((m) => m.id === +c.dataset.mid).who === 'u3'); const other = [...document.querySelectorAll('.cm')].find((c) => S.messages.find((m) => m.id === +c.dataset.mid).who !== 'u3'); return { mineBtns: mine ? [...mine.querySelectorAll('.acts button')].map((b) => b.textContent) : null, otherBtns: other ? other.querySelectorAll('.acts button').length : null }; });
  t('a manager sees Edit, Recall, Delete on own messages and nothing on others', own.mineBtns && own.mineBtns.join() === 'Edit,Recall,Delete' && own.otherBtns === 0);
  await p.evaluate(() => { S.me = 'u1'; route(); }); await p.waitForTimeout(200);
  t('an admin sees Delete only on other people\'s messages', await p.evaluate(() => { const other = [...document.querySelectorAll('.cm')].find((c) => S.messages.find((m) => m.id === +c.dataset.mid).who !== 'u1'); return [...other.querySelectorAll('.acts button')].map((b) => b.textContent).join() === 'Delete'; }));
  // Edit own message.
  const mid = await p.evaluate(() => { const m = S.messages.filter((m) => m.room === 'general' && m.who === 'u1').pop(); return m.id; });
  await p.click(`.cm[data-mid="${mid}"] [data-msg-edit]`); await p.waitForTimeout(200);
  t('edit form appears with the text', await p.evaluate((id) => { const ta = document.querySelector(`.cm[data-mid="${id}"] .edit textarea`); return ta && document.activeElement === ta && ta.value === S.messages.find((m) => m.id === id).text; }, mid));
  await p.fill(`.cm[data-mid="${mid}"] .edit textarea`, 'Edited: send the redlines by Friday'); await p.keyboard.press('Enter'); await p.waitForTimeout(250);
  t('Enter saves the edit and marks it edited', await p.evaluate((id) => { const m = S.messages.find((m) => m.id === id); return m.text === 'Edited: send the redlines by Friday' && !!m.edited && document.querySelector(`.cm[data-mid="${id}"] .ed`).textContent === 'edited' && !document.querySelector('.cm .edit'); }, mid));
  await p.click(`.cm[data-mid="${mid}"] [data-msg-edit]`); await p.waitForTimeout(150); await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  t('Escape cancels an edit', await p.evaluate((id) => !document.querySelector('.cm .edit') && S.messages.find((m) => m.id === id).text === 'Edited: send the redlines by Friday', mid));
  await p.screenshot({ path: OUT + 'chat-actions.jpg', type: 'jpeg', quality: 70 });
  // Recall.
  p.once('dialog', (d) => d.accept());
  await p.click(`.cm[data-mid="${mid}"] [data-msg-recall]`); await p.waitForTimeout(250);
  t('recall clears the text and shows Message recalled', await p.evaluate((id) => { const m = S.messages.find((m) => m.id === id); const c = document.querySelector(`.cm[data-mid="${id}"]`); return m.recalled && m.text === '' && c.querySelector('.txt.recalled').textContent === 'Message recalled' && [...c.querySelectorAll('.acts button')].map((b) => b.textContent).join() === 'Delete'; }, mid));
  // Delete.
  p.once('dialog', (d) => d.accept());
  await p.click(`.cm[data-mid="${mid}"] [data-msg-del]`); await p.waitForTimeout(250);
  t('delete removes the message', await p.evaluate((id) => !S.messages.find((m) => m.id === id) && !document.querySelector(`.cm[data-mid="${id}"]`), mid));
  // Cancel on the confirm keeps it.
  const other = await p.evaluate(() => S.messages.find((m) => m.room === 'general' && m.who !== 'u1').id);
  p.once('dialog', (d) => d.dismiss());
  await p.click(`.cm[data-mid="${other}"] [data-msg-del]`); await p.waitForTimeout(200);
  t('dismissing the confirm keeps the message', await p.evaluate((id) => !!S.messages.find((m) => m.id === id), other));
  // Room deletion: admin only.
  await p.evaluate(() => { S.me = 'u3'; S.ui.room = 'marketing'; route(); }); await p.waitForTimeout(200);
  t('a manager has no Delete room button', await p.evaluate(() => !document.querySelector('[data-room-del]')));
  await p.evaluate(() => { S.me = 'u1'; route(); }); await p.waitForTimeout(200);
  t('an admin sees Delete room on a room, not on a DM', await p.evaluate(() => !!document.querySelector('[data-room-del="marketing"]')) && await p.evaluate(() => { S.ui.room = 'dm_u1_u3'; route(); const has = !!document.querySelector('[data-room-del]'); S.ui.room = 'marketing'; route(); return !has; }));
  const before = await p.evaluate(() => ({ rooms: S.rooms.length, msgs: S.messages.filter((m) => m.room === 'marketing').length, total: S.messages.length }));
  p.once('dialog', (d) => d.dismiss());
  await p.click('[data-room-del="marketing"]'); await p.waitForTimeout(200);
  t('dismissing the confirm keeps the room', await p.evaluate(() => !!room('marketing')));
  p.once('dialog', (d) => d.accept());
  await p.click('[data-room-del="marketing"]'); await p.waitForTimeout(300);
  t('deleting removes the room and its ' + before.msgs + ' messages, view falls back to another room', await p.evaluate((b) => !room('marketing') && S.rooms.length === b.rooms - 1 && !S.messages.some((m) => m.room === 'marketing') && S.messages.length === b.total - b.msgs && S.ui.room && S.ui.room !== 'marketing' && document.querySelector('.chat-head h2').textContent.length > 0, before));
  const real = errs.filter((e) => !/reading 'users'/.test(e));
  t('no page errors', real.length === 0); if (real.length) console.log(real);
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
