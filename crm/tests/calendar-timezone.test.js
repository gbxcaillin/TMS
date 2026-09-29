// Calendar navigation in a UTC+10 browser (Australia/Melbourne), plus the date helpers.
const { chromium } = require('playwright-core');
const fs = require('node:fs'), http = require('node:http'), path = require('node:path');
const ROOT = require('node:path').resolve(__dirname, '..') + '';
const t = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) process.exitCode = 1; };
(async () => {
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${fs.readFileSync(ROOT + '/wireframe.html', 'utf8')}</body></html>`;
  const srv = http.createServer((req, res) => { const u = req.url.split('?')[0]; const f = path.join(ROOT, u); if (u.startsWith('/icons/') && fs.existsSync(f)) { res.setHeader('content-type', 'image/png'); return res.end(fs.readFileSync(f)); } res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html); }).listen(3285);
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
  for (const tz of ['Australia/Melbourne', 'UTC', 'America/Los_Angeles']) {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, timezoneId: tz });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('http://127.0.0.1:3285/', { waitUntil: 'load' });
    await p.evaluate(() => { NET.mode = 'local'; S.loggedIn = true; S.me = 'u1'; S.ui.calView = 'month'; S.ui.calAnchor = '2026-09-28'; location.hash = '#/calendar'; route(); });
    await p.waitForTimeout(200);
    const h = async () => p.evaluate(() => ({ title: document.querySelector('.page-head h1').textContent, anchor: S.ui.calAnchor }));
    t(`[${tz}] helpers: addDays(2026-09-28, 7) = 2026-10-05, addInterval month = 2026-10-28, ymd(local midnight) keeps the day`, await p.evaluate(() => addDays('2026-09-28', 7) === '2026-10-05' && addInterval('2026-09-28', 1, 'month') === '2026-10-28' && ymd(new Date('2026-10-01T00:00:00')) === '2026-10-01' && addDays('2026-12-31', 1) === '2027-01-01'));
    let r = await h(); t(`[${tz}] starts on September 2026`, /September 2026/.test(r.title));
    await p.click('#cal-next'); await p.waitForTimeout(150); r = await h();
    t(`[${tz}] next month shows October 2026 (${r.anchor})`, /October 2026/.test(r.title) && r.anchor === '2026-10-01');
    await p.click('#cal-next'); await p.waitForTimeout(150); await p.click('#cal-next'); await p.waitForTimeout(150); r = await h();
    t(`[${tz}] two more steps reach December 2026`, /December 2026/.test(r.title));
    await p.click('#cal-next'); await p.waitForTimeout(150); r = await h();
    t(`[${tz}] crosses into January 2027`, /January 2027/.test(r.title) && r.anchor === '2027-01-01');
    await p.click('#cal-prev'); await p.waitForTimeout(150); r = await h();
    t(`[${tz}] back to December 2026`, /December 2026/.test(r.title));
    await p.click('[data-calview="week"]'); await p.waitForTimeout(150);
    await p.evaluate(() => { S.ui.calAnchor = '2026-09-28'; route(); }); await p.waitForTimeout(150);
    await p.click('#cal-next'); await p.waitForTimeout(150); r = await h();
    t(`[${tz}] week view steps forward a week (${r.anchor})`, r.anchor === '2026-10-05' && /5 Oct/.test(r.title));
    const firstDay = await p.evaluate(() => document.querySelector('.wk .wh.today, .wk .wh:nth-child(2)').textContent);
    t(`[${tz}] week starts on Monday 5 (${firstDay})`, /Mon5/.test(firstDay.replace(/\s/g, '')));
    // An evening event stretches the grid instead of running off it; a normal week stays 07:00 to 19:00.
    const base = await p.evaluate(() => ({ h: document.querySelector('.wk .col').offsetHeight, first: document.querySelector('.wk .gut .hr').textContent, last: [...document.querySelectorAll('.wk .gut .hr')].pop().textContent }));
    t(`[${tz}] default grid 07:00 to 18:00 rows, 720px`, base.h === 720 && base.first === '07:00' && base.last === '18:00');
    await p.evaluate(() => { S.events.push({ id: 9001, title: 'Sea shanties', start: '2026-10-08T16:30', end: '2026-10-08T21:45', who: ['u1'], allDay: false, kind: 'Meeting' }); route(); }); await p.waitForTimeout(150);
    const late = await p.evaluate(() => { const col = document.querySelector('.wk .col[data-day="2026-10-08"]'); const ev = col.querySelector('.wev'); return { colH: col.offsetHeight, top: ev.offsetTop, bottom: ev.offsetTop + ev.offsetHeight, last: [...document.querySelectorAll('.wk .gut .hr')].pop().textContent, gutH: document.querySelector('.wk .gut').offsetHeight }; });
    t(`[${tz}] a 16:30 to 21:45 event extends the grid to 22:00 and stays inside its column (${late.top} to ${late.bottom} of ${late.colH})`, late.colH === 900 && late.gutH === 900 && late.last === '21:00' && late.top === 570 && late.bottom === 885);
    await p.evaluate(() => { S.events.push({ id: 9002, title: 'Early swim', start: '2026-10-06T05:15', end: '2026-10-06T06:00', who: ['u1'], allDay: false, kind: 'Meeting' }); route(); }); await p.waitForTimeout(150);
    t(`[${tz}] an early event extends the top to 05:00`, await p.evaluate(() => document.querySelector('.wk .gut .hr').textContent === '05:00' && document.querySelector('.wk .col[data-day="2026-10-06"] .wev').offsetTop === 15));
    await p.evaluate(() => { S.events = S.events.filter((e) => e.id < 9000); });
    t(`[${tz}] no page errors`, errs.filter((e) => !/reading 'users'/.test(e)).length === 0);
    await ctx.close();
  }
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
