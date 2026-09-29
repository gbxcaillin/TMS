'use strict';
/* Renders the training screenshots for Help & training (docs/img/*.jpg) from the sample data
 * in wireframe.html, so they never show real client records and can be re-made after any
 * change to the app. Run from the repo root:
 *
 *   CHROME_BIN=/path/to/chrome NODE_PATH=/path/with/playwright-core node server/tools/screenshots.js
 *
 * Needs playwright-core and a Chromium binary (same as icons/render.mjs). Rerun whenever a
 * screen changes, then commit docs/img. Add a shot here when you add a screen. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'img');
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let chromium; try { ({ chromium } = require('playwright-core')); } catch (e) { console.error('playwright-core not found: set NODE_PATH to a node_modules that has it'); process.exit(1); }

// A screenshot = a name, a route, optional setup JS run inside the page, a viewport, and an optional selector to tap.
const DESK = { width: 1280, height: 860 };
const PHONE = { width: 412, height: 880, mobile: true };
const SHOTS = [
  ['dashboard', '#/dashboard'],
  ['pipeline', '#/pipeline'],
  ['deal', '#/deal/3'],
  ['deal-email', '#/deal/3', "S.ui.dealTab[3]='email';route()"],
  ['new-lead', '#/pipeline', 'openAdd()'],
  ['clients', '#/clients'],
  ['client', '#/client/1'],
  ['tasks', '#/tasks'],
  ['task', '#/tasks', 'openTask()'],
  ['calendar', '#/calendar'],
  ['email', '#/email'],
  ['chat', '#/chat'],
  ['mailing', '#/mailing'],
  ['compose', '#/mailing', 'openBulkCompose()'],
  ['calls', '#/calls', "S.calls=[{id:1,provider:'justcall',direction:'in',number:'+61 3 9021 4402',who:'u1',at:'2026-09-03T10:12',duration:412,status:'completed',deal:1,summary:'Sarah asked for the funnel proposal by Friday and confirmed the adviser call scripts are the priority. Next: send the proposal and book the Health Check follow-up.',transcript:'Sarah: Hi, thanks for calling back.\\nAlex: No problem, wanted to check on the proposal timing.',recording:'#'},{id:2,provider:'justcall',direction:'out',number:'+61 7 3188 2210',who:'u3',at:'2026-09-03T09:40',duration:95,status:'completed',deal:2,summary:'Left a message about the analytics dashboard scope; James to call back after his partners meeting.'},{id:3,provider:'justcall',direction:'in',number:'+61 400 111 222',who:'u1',at:'2026-09-02T16:05',duration:0,status:'missed',deal:0}];S.ui.callsMine=false;route()"],
  ['nurture', '#/nurture'],
  ['files', '#/files'],
  ['invoices', '#/invoices'],
  ['invoice', '#/invoice/1'],
  ['reports', '#/reports'],
  ['research', '#/research'],
  ['security', '#/security/VAS.AX'],
  ['model', '#/model/1'],
  ['integrations', '#/integrations'],
  ['settings-routing', '#/settings/routing'],
  ['settings-notifications', '#/settings/notifications'],
  ['settings-team', '#/settings/team'],
  ['settings-access', '#/settings/access'],
  ['settings-access-user', '#/settings/team', "openUserAccess('u4')"],
  ['settings-fields', '#/settings/fields'],
  ['phone-dashboard', '#/dashboard', '', PHONE],
  ['phone-more', '#/dashboard', '', PHONE, '#tb-more'],
  ['phone-deal', '#/deal/3', '', PHONE],
];

const MIME = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
function serve(dir) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
      const f = path.join(dir, p);
      if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

(async () => {
  // A full document around the wireframe fragment, with the sample data left in (local mode).
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'acme-shots-'));
  fs.mkdirSync(path.join(tmp, 'icons'));
  for (const f of fs.readdirSync(path.join(ROOT, 'icons'))) if (/\.(svg|png)$/.test(f)) fs.copyFileSync(path.join(ROOT, 'icons', f), path.join(tmp, 'icons', f));
  fs.writeFileSync(path.join(tmp, 'index.html'), `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${fs.readFileSync(path.join(ROOT, 'wireframe.html'), 'utf8')}</body></html>`);
  const { srv, port } = await serve(tmp);
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  let n = 0;
  for (const [name, hash, setup = '', vp = DESK, tap = ''] of SHOTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, isMobile: !!vp.mobile, hasTouch: !!vp.mobile, colorScheme: 'light', locale: 'en-AU' });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
    await page.evaluate(([h, s]) => {
      try { localStorage.clear(); } catch (e) { /* ignore */ }
      document.documentElement.setAttribute('data-theme', 'light');
      S.loggedIn = true; S.me = 'u1'; location.hash = h; route();
      if (s) { try { eval(s); } catch (e) { console.error('setup failed', s, e.message); } }
    }, [hash, setup]);
    if (tap) await page.tap(tap);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, name + '.jpg'), type: 'jpeg', quality: 82 });
    await ctx.close(); n++;
    process.stdout.write(name + ' ');
  }
  await browser.close(); srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${n} screenshots → docs/img`);
})().catch((e) => { console.error(e); process.exit(1); });
