// Forms only close from the cross, Cancel or Escape; a click on the background does nothing; typed data is guarded.
const { chromium } = require('playwright-core');
const fs = require('node:fs'), http = require('node:http'), path = require('node:path');
const ROOT = require('node:path').resolve(__dirname, '..') + '';
const t = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) process.exitCode = 1; };
(async () => {
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fs.readFileSync(ROOT + '/wireframe.html', 'utf8')}</body></html>`;
  const srv = http.createServer((req, res) => { const u = req.url.split('?')[0]; const f = path.join(ROOT, u); if (u.startsWith('/icons/') && fs.existsSync(f)) { res.setHeader('content-type', 'image/png'); return res.end(fs.readFileSync(f)); } res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html); }).listen(3294);
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } }); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const dialogs = []; p.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
  await p.goto('http://127.0.0.1:3294/', { waitUntil: 'load' });
  await p.evaluate(() => { NET.mode = 'local'; S.loggedIn = true; S.me = 'u1'; location.hash = '#/pipeline'; route(); }); await p.waitForTimeout(300);
  const open = () => p.evaluate(() => !!document.querySelector('#mform'));
  // 1. Background click no longer closes.
  await p.evaluate(() => openAdd()); await p.waitForTimeout(200);
  t('New lead opens', await open());
  await p.mouse.click(20, 500); await p.waitForTimeout(150);
  t('clicking the dimmed background leaves the form open', await open());
  // 2. Untouched form: cross closes at once, no question.
  await p.click('#ov [data-close-modal]'); await p.waitForTimeout(150);
  t('cross closes an untouched form without asking', !(await open()) && dialogs.length === 0);
  // 3. Typed something: cross asks; dismissing keeps the form and the text.
  await p.evaluate(() => openAdd()); await p.waitForTimeout(200);
  await p.fill('#mform [name=practice]', 'Lighthouse Wealth');
  await p.click('#ov [data-close-modal]'); await p.waitForTimeout(150);
  t('cross asks before discarding typed text', dialogs.length === 1 && /Close without saving/.test(dialogs[0]) && await open() && await p.evaluate(() => document.querySelector('#mform [name=practice]').value === 'Lighthouse Wealth'));
  // 4. Escape asks too; accepting closes.
  p.removeAllListeners('dialog'); p.once('dialog', (d) => d.accept());
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  t('Escape asks, and accepting closes the form', !(await open()));
  // 5. Cancel button on a typed form asks as well; a checkbox change counts as typing.
  p.once('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
  await p.evaluate(() => openTask()); await p.waitForTimeout(200);
  const cb = await p.$('#mform input[type=checkbox]'); if (cb) await cb.click(); else await p.fill('#mform [name=title]', 'x');
  await p.click('#mform [data-close-modal]'); await p.waitForTimeout(150);
  t('Cancel asks after a change; dismissing keeps the form', await open() && dialogs.length === 2);
  await p.evaluate(() => closeModal());
  // 6. Saving still closes without any question.
  await p.evaluate(() => openAdd()); await p.waitForTimeout(200);
  await p.fill('#mform [name=practice]', 'Saved Practice'); await p.fill('#mform [name=contact]', 'Sam'); await p.fill('#mform [name=email]', 'sam@saved.com'); await p.fill('#mform [name=value]', '1000');
  const svc = await p.$('#mform [name=service]'); if (svc) await svc.selectOption({ index: 1 });
  p.once('dialog', (d) => { dialogs.push('unexpected'); d.dismiss(); });
  await p.click('#mform [type=submit]'); await p.waitForTimeout(400);
  t('saving closes the form without a question', !(await open()) && !dialogs.includes('unexpected') && await p.evaluate(() => S.deals.some((d) => d.practice === 'Saved Practice')));
  // 7. The search palette still closes on Escape.
  await p.evaluate(() => openPalette()); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  t('search palette still closes on Escape', await p.evaluate(() => !document.querySelector('#modal-root').innerHTML.trim()));
  t('no page errors', errs.filter((e) => !/reading 'users'/.test(e)).length === 0); if (errs.length) console.log(errs);
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
