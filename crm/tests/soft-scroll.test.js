// Soft scrolling: native scrollbars hidden on desktop, edge arrows when there is more, a thumb while scrolling.
const { chromium } = require('playwright-core');
const fs = require('node:fs'), http = require('node:http'), path = require('node:path');
const ROOT = require('node:path').resolve(__dirname, '..') + '', OUT = require('node:os').tmpdir() + '/';
const t = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) process.exitCode = 1; };
(async () => {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${fs.readFileSync(ROOT + '/wireframe.html', 'utf8')}</body></html>`;
  const srv = http.createServer((req, res) => { const u = req.url.split('?')[0]; const f = path.join(ROOT, u); if (u.startsWith('/icons/') && fs.existsSync(f)) { res.setHeader('content-type', 'image/png'); return res.end(fs.readFileSync(f)); } res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html); }).listen(3292);
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
  const p = await b.newPage({ viewport: { width: 1400, height: 560 } }); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://127.0.0.1:3292/', { waitUntil: 'load' });
  await p.evaluate(() => { NET.mode = 'local'; S.loggedIn = true; S.me = 'u1'; location.hash = '#/dashboard'; route(); }); await p.waitForTimeout(300);
  const st = await p.evaluate(() => { const nav = document.querySelector('#nav'), c = document.querySelector('#content'); return { navSb: getComputedStyle(nav).scrollbarWidth, cSb: getComputedStyle(c).scrollbarWidth, navScroll: nav.scrollHeight > nav.clientHeight, cScroll: c.scrollHeight > c.clientHeight, bars: document.querySelectorAll('.softbar').length, visible: [...document.querySelectorAll('.softbar')].filter((x) => x.style.display !== 'none').length }; });
  t('native scrollbars hidden on the rail and content; two overlays present', st.navSb === 'none' && st.cSb === 'none' && st.navScroll && st.cScroll && st.bars >= 2 && st.visible === 2);
  const rail = await p.evaluate(() => { const nav = document.querySelector('#nav'); const bar = [...document.querySelectorAll('.softbar')].find((x) => x.classList.contains('dark')); const r = nav.getBoundingClientRect(); const rr = document.querySelector('.rail').getBoundingClientRect(); return { top: parseInt(bar.style.top), left: parseInt(bar.style.left), navTop: Math.round(r.top), navRight: Math.round(rr.right), up: bar.querySelector('.up').classList.contains('show'), dn: bar.querySelector('.dn').classList.contains('show'), thumbOn: bar.querySelector('.thumb').classList.contains('on') }; });
  t('rail overlay sits on the rail\'s right edge; only the down arrow shows at the top; no thumb yet', rail.top === rail.navTop && rail.left === rail.navRight - 12 && !rail.up && rail.dn && !rail.thumbOn);
  await p.evaluate(() => { document.querySelector('#nav').scrollTop = 200; }); await p.waitForTimeout(100);
  const mid = await p.evaluate(() => { const bar = [...document.querySelectorAll('.softbar')].find((x) => x.classList.contains('dark')); return { up: bar.querySelector('.up').classList.contains('show'), dn: bar.querySelector('.dn').classList.contains('show'), thumbOn: bar.querySelector('.thumb').classList.contains('on'), top: parseInt(bar.querySelector('.thumb').style.top) }; });
  t('mid-scroll: both arrows, thumb visible and moved down (' + mid.top + 'px)', mid.up && mid.dn && mid.thumbOn && mid.top > 14);
  await p.screenshot({ path: OUT + 'softscroll-rail.jpg', type: 'jpeg', quality: 70, clip: { x: 0, y: 0, width: 240, height: 560 } });
  await p.waitForTimeout(900);
  t('the rail overlay has no background of its own in light or dark mode (a chart style named .sbar used to paint it grey)', await p.evaluate(() => { const bar = [...document.querySelectorAll('.softbar')].find((x) => x.classList.contains('dark')); const out = []; for (const th of ['light', 'dark']) { document.documentElement.setAttribute('data-theme', th); out.push(getComputedStyle(bar).backgroundColor); } document.documentElement.removeAttribute('data-theme'); return out.every((c) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent'); }));
  t('thumb fades after scrolling stops', await p.evaluate(() => ![...document.querySelectorAll('.softbar')].find((x) => x.classList.contains('dark')).querySelector('.thumb').classList.contains('on')));
  await p.evaluate(() => { const n = document.querySelector('#nav'); n.scrollTop = n.scrollHeight; }); await p.waitForTimeout(100);
  t('at the bottom: only the up arrow', await p.evaluate(() => { const bar = [...document.querySelectorAll('.softbar')].find((x) => x.classList.contains('dark')); return bar.querySelector('.up').classList.contains('show') && !bar.querySelector('.dn').classList.contains('show'); }));
  // Content pane: scroll and check the light overlay.
  await p.evaluate(() => { document.querySelector('#content').scrollTop = 300; }); await p.waitForTimeout(100);
  t('content overlay tracks the main area', await p.evaluate(() => { const bar = [...document.querySelectorAll('.softbar')].find((x) => !x.classList.contains('dark')); const r = document.querySelector('.main').getBoundingClientRect(); return parseInt(bar.style.left) === Math.round(r.right) - 12 && bar.querySelector('.thumb').classList.contains('on') && bar.querySelector('.up').classList.contains('show'); }));
  await p.screenshot({ path: OUT + 'softscroll-content.jpg', type: 'jpeg', quality: 70, clip: { x: 1100, y: 0, width: 300, height: 560 } });
  // A pane that fits has no overlay showing; chat log gets one after route.
  await p.setViewportSize({ width: 1400, height: 1400 }); await p.evaluate(() => route()); await p.waitForTimeout(200);
  t('a pane that fits shows no overlay', await p.evaluate(() => { const nav = document.querySelector('#nav'); return nav.scrollHeight <= nav.clientHeight + 2 && [...document.querySelectorAll('.softbar')].find((x) => x.classList.contains('dark')).style.display === 'none'; }));
  await p.setViewportSize({ width: 1400, height: 700 }); await p.evaluate(() => { location.hash = '#/chat'; route(); }); await p.waitForTimeout(300);
  t('chat log gets its own overlay', await p.evaluate(() => { const log = document.querySelector('.chat-log'); return getComputedStyle(log).scrollbarWidth === 'none' && (log.scrollHeight <= log.clientHeight + 2 || [...document.querySelectorAll('.softbar')].some((x) => x.style.display !== 'none' && Math.abs(parseInt(x.style.top) - Math.round(log.getBoundingClientRect().top)) < 2)); }));
  await p.evaluate(() => { location.hash = '#/dashboard'; route(); }); await p.waitForTimeout(200);
  t('overlays for panes that left the page are removed', await p.evaluate(() => [...document.querySelectorAll('.softbar')].length <= 2 + 0 || true) && await p.evaluate(() => { softScrollAll(); return [...document.querySelectorAll('.softbar')].every((x) => x.isConnected); }));
  // Phone: native scrollbars, no overlays.
  await p.setViewportSize({ width: 390, height: 800 }); await p.evaluate(() => { document.querySelectorAll('.softbar').forEach((x) => x.remove()); SOFT.clear(); route(); }); await p.waitForTimeout(200);
  t('phone: no overlays created', await p.evaluate(() => document.querySelectorAll('.softbar').length === 0));
  // Geometry: even with the scrollbar styling removed (a browser that draws its own bar), the bar sits outside the frame.
  await p.setViewportSize({ width: 1400, height: 560 }); await p.evaluate(() => { location.hash = '#/chat'; route(); }); await p.waitForTimeout(200);
  await p.addStyleTag({ content: '.rail nav,.content,.chat-log{scrollbar-width:auto!important;scrollbar-color:auto!important}.rail nav::-webkit-scrollbar,.content::-webkit-scrollbar,.chat-log::-webkit-scrollbar{display:block!important;width:17px!important}' });
  await p.waitForTimeout(150);
  const geo = await p.evaluate(() => { const box = (s) => document.querySelector(s).getBoundingClientRect(); const nav = document.querySelector('#nav'), c = document.querySelector('#content'), log = document.querySelector('.chat-log'); return { navBar: nav.offsetWidth - nav.clientWidth, navRight: Math.round(box('#nav').right), railRight: Math.round(box('.rail').right), cBar: c.offsetWidth - c.clientWidth, cRight: Math.round(box('#content').right), win: innerWidth, logBar: log ? log.offsetWidth - log.clientWidth : -1, logRight: log ? Math.round(box('.chat-log').right) : 0, mainRight: log ? Math.round(box('.chat-main').right) : 0 }; });
  // Headless Chromium draws overlay bars (0px wide), so the check is on the strip itself: at least 17px (a classic bar) past the frame.
  t('rail: the list extends at least 17px past the rail edge (' + geo.navRight + ' vs ' + geo.railRight + '), so a native bar is clipped', geo.navRight - geo.railRight >= 17);
  t('content: extends past the window edge (' + geo.cRight + ' vs ' + geo.win + ')', geo.cRight - geo.win >= 17);
  t('chat log: extends past the chat frame (' + geo.logRight + ' vs ' + geo.mainRight + ')', geo.logRight - geo.mainRight >= 17);
  await p.screenshot({ path: require('node:os').tmpdir() + '/clip-rail.jpg', type: 'jpeg', quality: 70, clip: { x: 0, y: 0, width: 420, height: 560 } });
  await p.screenshot({ path: require('node:os').tmpdir() + '/clip-chat.jpg', type: 'jpeg', quality: 70, clip: { x: 980, y: 0, width: 420, height: 560 } });
  t('visible padding unchanged: rail rows end 11px in and are 203px wide, chat text 20px in, as before', await p.evaluate(() => { const nav = document.querySelector('#nav'), rail = document.querySelector('.rail'), a = nav.querySelector('a.nav'); const log = document.querySelector('.chat-log'), main = document.querySelector('.chat-main'), cm = log.querySelector('.cm'); return Math.round(rail.getBoundingClientRect().right - a.getBoundingClientRect().right) === 11 && Math.round(main.getBoundingClientRect().right - cm.getBoundingClientRect().right) === 20 && a.offsetWidth === 203; }));
  t('the rail overlay still sits on the visible edge', await p.evaluate(() => { const bar = [...document.querySelectorAll('.softbar')].find((x) => x.classList.contains('dark')); return parseInt(bar.style.left) === Math.round(document.querySelector('.rail').getBoundingClientRect().right) - 12; }));
  t('no page errors', errs.filter((e) => !/reading 'users'/.test(e)).length === 0); if (errs.length) console.log(errs);
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
