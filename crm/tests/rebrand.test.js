// Rebranding: on a copy of the project, a new brand.json (name, slug, domain, colours, a person, Research switched
// off) is applied by tools/rebrand.js. No trace of the old brand is left in any text file, the app opens with the new
// name and colour, and the switched-off module is gone from the menu and redirects home. A second run changes nothing.
// Icons need Chromium and are left for a run that has it (the script records that they are still owed).
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const ROOT = path.resolve(__dirname, '..');
const t = (n, ok, extra) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || extra === undefined ? '' : ' :: ' + JSON.stringify(extra).slice(0, 400))); if (!ok) process.exitCode = 1; };
const SKIP = new Set(['.git', 'node_modules', 'dist', 'data']);
function copy(src, dst) { fs.mkdirSync(dst, { recursive: true }); for (const e of fs.readdirSync(src, { withFileTypes: true })) { if (SKIP.has(e.name)) continue; const a = path.join(src, e.name), b = path.join(dst, e.name); if (e.isDirectory()) copy(a, b); else fs.copyFileSync(a, b); } }
function* walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!SKIP.has(e.name)) yield* walk(p); } else yield p; } }
(async () => {
  const W = fs.mkdtempSync(path.join(os.tmpdir(), 'rebrand-')); copy(ROOT, W);
  const old = JSON.parse(fs.readFileSync(path.join(W, '.brand-applied.json'), 'utf8'));
  const b = JSON.parse(fs.readFileSync(path.join(W, 'brand.json'), 'utf8'));
  Object.assign(b, { company: 'Zenith Partners', legal: 'Zenith Partners Pty Ltd', product: 'Zenith Desk', short: 'ZEN', slug: 'zenithx', domain: 'zenith.test', appHost: 'desk.zenith.test', sharepointHost: 'zenith.sharepoint.test', packageName: 'zenith-desk-server' });
  b.people = b.people.map((p, i) => i === 0 ? { name: 'Robin Vale', first: 'Robin', email: 'robin' } : p);
  b.colors = { ...b.colors, accent: '#C2410C' }; b.modules = { ...b.modules, research: false };
  fs.writeFileSync(path.join(W, 'brand.json'), JSON.stringify(b, null, 2));
  const env = { ...process.env }; delete env.CHROME_BIN; // text only: icons are not part of this check
  const r1 = spawnSync(process.execPath, ['tools/rebrand.js'], { cwd: W, env, encoding: 'utf8' });
  t('the script runs and reports what it changed', r1.status === 0 && /Changed \d+ files; modules off: research/.test(r1.stdout), r1.stdout + r1.stderr);
  t('without Chromium it says the icons are still to draw, and remembers', /Icons not redrawn/.test(r1.stdout) && JSON.parse(fs.readFileSync(path.join(W, '.brand-applied.json'), 'utf8')).iconsPending === true);
  const left = [];
  const words = [old.company, old.product, old.legal, old.domain, old.people[0].name, old.colors.accent];
  const token = new RegExp(`(?<![A-Za-z0-9])(${old.short}|${old.slug})(?![A-Za-z0-9])`);
  for (const f of walk(W)) {
    const rel = path.relative(W, f); if (!/\.(html|js|json|md|svg|sh|yml|example|webmanifest|py|service|txt)$|Dockerfile$/.test(rel) || /^(brand\.json|\.brand-applied\.json|START-HERE\.md|tools\/rebrand\.js)$|package-lock\.json$|^(icons|brand)\//.test(rel)) continue; // brand/ holds the logo art, which rebrand.js leaves alone
    const s = fs.readFileSync(f, 'utf8'); for (const w of words) if (s.toLowerCase().includes(w.toLowerCase())) left.push(rel + ': ' + w); if (token.test(s)) left.push(rel + ': ' + s.match(token)[0]);
  }
  t('no trace of the old name, domain, person, accent colour or slug in any text file', left.length === 0, left.slice(0, 12));
  t('the applied record now matches brand.json', JSON.parse(fs.readFileSync(path.join(W, '.brand-applied.json'), 'utf8')).company === 'Zenith Partners');
  const r2 = spawnSync(process.execPath, ['tools/rebrand.js'], { cwd: W, env, encoding: 'utf8' });
  t('running it again changes nothing', /Changed 0 files/.test(r2.stdout), r2.stdout);
  const br = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined }); const errs = [];
  try {
    const p = await br.newPage({ viewport: { width: 1280, height: 800 } }); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('file://' + path.join(W, 'wireframe.html') + '#/dashboard'); await p.waitForTimeout(800);
    await p.click('#login [type=submit]'); await p.waitForFunction(() => typeof S === 'object' && S && S.loggedIn, null, { timeout: 10000 }); await p.waitForTimeout(500);
    t('the app carries the new name', /Zenith/.test(await p.title()) && /Robin/.test(await p.innerText('#content')), await p.title());
    t('the accent colour is the new one', (await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--teal').trim().toUpperCase())) === '#C2410C');
    t('Research is gone from the menu', await p.evaluate(() => { const n = document.querySelector('#nav [data-r="research"]'); return !n || n.hidden; }));
    await p.evaluate(() => { location.hash = '#/research'; }); await p.waitForTimeout(500);
    t('its address sends you home instead', !/#\/research/.test(p.url()));
    t('no page errors', errs.length === 0, errs);
    // Font families are swapped as whole words: moving the body face to "Inter" and on to another family must
    // leave identifiers that contain the name (setInterval, clearInterval) alone.
    const count = (f, w) => fs.readFileSync(path.join(W, f), 'utf8').split(w).length - 1;
    const before = count('server/lib/auth.js', 'setInterval');
    for (const sans of ['Inter', 'Lato']) {
      const bj = JSON.parse(fs.readFileSync(path.join(W, 'brand.json'), 'utf8')); bj.fonts = { ...bj.fonts, sans };
      fs.writeFileSync(path.join(W, 'brand.json'), JSON.stringify(bj, null, 2));
      spawnSync(process.execPath, ['tools/rebrand.js'], { cwd: W, env, encoding: 'utf8' });
    }
    t('a font called Inter does not rewrite setInterval', before > 0 && count('server/lib/auth.js', 'setInterval') === before && !/setLato|Latoval/.test(fs.readFileSync(path.join(W, 'wireframe.html'), 'utf8')) && count('wireframe.html', "'Lato'") > 0, { before });
  } finally { await br.close(); fs.rmSync(W, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exit(1); });
