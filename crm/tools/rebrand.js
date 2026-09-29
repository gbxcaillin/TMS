#!/usr/bin/env node
'use strict';
// Rebrands the whole project from brand.json: names, domain, people in the sample data, colours, fonts, tagline,
// the logo and app icons, and which modules are switched on. It compares brand.json with .brand-applied.json (what
// the files hold now), replaces each changed value wherever it appears (app, server, emails, PDFs, docs, tests),
// then records brand.json as applied. Run it again after any edit to brand.json; it only changes what differs.
//
//   node tools/rebrand.js            apply brand.json
//   node tools/rebrand.js --dry      list what would change, write nothing
//   node tools/rebrand.js --shots    also re-render the Help & training screenshots (docs/img)
//
// Icons and screenshots are drawn with Chromium through playwright-core: set CHROME_BIN, and NODE_PATH to a
// node_modules that has playwright-core (npm i -g playwright-core, or install it in tests/). Without them the text
// is still rebranded and the script says which images it could not redraw.
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry');
const SHOTS = process.argv.includes('--shots');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const want = read('brand.json');
const have = read('.brand-applied.json');

// ---- 1. Text: one pass over every text file, longest match first, so no value is replaced twice.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const title = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pairs = []; // [from, to, boundary]
const add = (from, to, boundary = false) => { if (from && to != null && from !== to) pairs.push([from, to, boundary]); };
add(have.repo, want.repo);
(have.people || []).forEach((p, i) => { const q = (want.people || [])[i]; if (!q) return; add(p.name, q.name); add(p.name.toUpperCase(), q.name.toUpperCase()); add(p.email + '@', q.email + '@'); add(p.first, q.first, true); add(p.first.toUpperCase(), q.first.toUpperCase(), true); });
add(have.appHost, want.appHost); add(have.sharepointHost, want.sharepointHost); add(have.domain, want.domain);
add(have.packageName, want.packageName);
add(have.company, want.company); add(have.legal, want.legal); add(have.product, want.product);
for (const k of ['company', 'legal', 'product']) add(have[k].toUpperCase(), want[k].toUpperCase());
(have.tagline || []).forEach((t, i) => add(t, (want.tagline || [])[i] || ''));
(have.cities || []).forEach((t, i) => add(t, (want.cities || [])[i] || ''));
add(have.bank, want.bank);
// The short name and slug also live in identifiers (invoice numbers, storage keys, cookie and service names): replaced
// only as a whole token, never inside a longer word or a base64 string.
add(have.short, want.short, 'token'); add(title(have.slug), title(want.slug), 'token'); add(have.slug, want.slug, 'token');
// Font names are matched as whole words: a family such as "Inter" must not rewrite identifiers like setInterval.
for (const k of ['serif', 'sans', 'mono']) { add(have.fonts[k], want.fonts[k], true); add(have.fonts[k].replace(/ /g, '+'), want.fonts[k].replace(/ /g, '+'), true); }

// A name right after an escaped newline in a string ("\\nAlex:") still counts as a whole word.
const textRe = pairs.length ? new RegExp(pairs.sort((a, b) => b[0].length - a[0].length).map(([f, , b]) => b === 'token' ? `(?:(?<=\\\\[nt])|(?<![A-Za-z0-9]))${esc(f)}(?![A-Za-z0-9+/=])` : b ? `(?:(?<=\\\\[nt])|(?<![A-Za-z0-9_]))${esc(f)}(?![A-Za-z0-9_])` : esc(f)).join('|'), 'g') : null;
const textMap = new Map(pairs.map(([f, t]) => [f, t]));
// Colours are matched case-insensitively as whole hex values.
const colorMap = new Map(); for (const k of Object.keys(have.colors || {})) if (want.colors[k] && have.colors[k].toLowerCase() !== want.colors[k].toLowerCase()) colorMap.set(have.colors[k].toLowerCase(), want.colors[k]);
const colorRe = colorMap.size ? new RegExp(`#(?:${[...colorMap.keys()].map((c) => c.slice(1)).join('|')})(?![0-9a-fA-F])`, 'gi') : null;
const fontUrlRe = /https:\/\/fonts\.googleapis\.com\/css2\?[^"')\s]+/g;
const fontUrlChanged = want.fonts.url && want.fonts.url !== have.fonts.url;

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'data', 'brand']);
const SKIP_FILES = new Set(['brand.json', '.brand-applied.json', 'START-HERE.md', 'tools/rebrand.js', 'icons/icon.svg', 'icons/maskable.svg', 'icons/badge.svg', 'icons/render.mjs']);
const TEXT = /\.(html|js|mjs|cjs|json|md|txt|svg|css|sh|ya?ml|service|example|webmanifest|py|conf|toml)$|(^|\/)(Dockerfile|\.gitignore|\.dockerignore|Caddyfile)$/;
function* walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* walk(p); } else yield p; } }
const changed = [];
for (const abs of walk(ROOT)) {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/');
  if (SKIP_FILES.has(rel) || !TEXT.test(rel)) continue;
  const before = fs.readFileSync(abs, 'utf8'); let s = before;
  // Lockfiles hold integrity hashes: only the package name changes there.
  if (/package-lock\.json$/.test(rel)) { if (have.packageName !== want.packageName) s = s.split(`"${have.packageName}"`).join(`"${want.packageName}"`); }
  else {
    if (textRe) s = s.replace(textRe, (m) => textMap.get(m) ?? m);
    if (colorRe) s = s.replace(colorRe, (m) => colorMap.get(m.toLowerCase()) || m);
    if (fontUrlChanged) s = s.replace(fontUrlRe, () => want.fonts.url);
  }
  if (s !== before) { changed.push(rel); if (!DRY) fs.writeFileSync(abs, s); }
}

// Files named after the brand (deploy/agent/<slug>-claude-helper.service) are renamed to match.
const renames = [];
if (have.slug !== want.slug) for (const abs of walk(ROOT)) { const b = path.basename(abs); if (b.startsWith(have.slug + '-')) renames.push([abs, path.join(path.dirname(abs), want.slug + b.slice(have.slug.length))]); }
if (!DRY) for (const [a, b] of renames) fs.renameSync(a, b);
if (renames.length) console.log(`${DRY ? 'Would rename' : 'Renamed'} ${renames.map(([a, b]) => path.relative(ROOT, a) + ' -> ' + path.basename(b)).join(', ')}`);

// ---- 2. Modules: the app hides switched-off modules (wireframe.html MODULES_OFF); the server skips their jobs.
const off = Object.entries(want.modules || {}).filter(([, on]) => on === false).map(([k]) => k);
const wf = path.join(ROOT, 'wireframe.html'); let w = fs.readFileSync(wf, 'utf8');
const w2 = w.replace(/const MODULES_OFF=\/\*modules\*\/\[[^\]]*\]\/\*end\*\//, `const MODULES_OFF=/*modules*/${JSON.stringify(off)}/*end*/`);
if (w2 !== w) { if (!DRY) fs.writeFileSync(wf, w2); if (!changed.includes('wireframe.html')) changed.push('wireframe.html'); }

console.log(`${DRY ? 'Would change' : 'Changed'} ${changed.length} files${off.length ? `; modules off: ${off.join(', ')}` : ''}.`);
if (DRY) { console.log(changed.map((f) => '  ' + f).join('\n')); process.exit(0); }

// ---- 3. Logo and icons.
(async () => {
  // Icons still owed from an earlier run without Chromium are drawn as soon as it is available.
  const brandChanged = have.iconsPending || JSON.stringify([have.colors, have.monogram, have.logo, have.company]) !== JSON.stringify([want.colors, want.monogram, want.logo, want.company]);
  let pw = null; try { pw = require('playwright-core'); } catch { /* optional */ }
  let pending = false;
  if (brandChanged) {
    if (!pw || !process.env.CHROME_BIN) { pending = true; console.log('Icons not redrawn: set CHROME_BIN and NODE_PATH (playwright-core), then run node tools/rebrand.js again.'); }
    else await drawIcons(pw);
  }
  fs.writeFileSync(path.join(ROOT, '.brand-applied.json'), JSON.stringify(pending ? { ...want, iconsPending: true } : want, null, 2) + '\n');
  if (SHOTS) {
    const r = require('node:child_process').spawnSync(process.execPath, ['server/tools/screenshots.js'], { cwd: ROOT, stdio: 'inherit', env: process.env });
    if (r.status) console.log('Screenshots failed; run node server/tools/screenshots.js after sh build.sh.');
  }
  console.log('Done. Now run: sh build.sh   (and node tests/run.js to check)');
})().catch((e) => { console.error(e); process.exit(1); });

// The app icon, maskable icon, notification badge and the light logo (sign-in page, invoices, PDFs). From your own
// files when brand.json names them (logo.mark: square image for dark backgrounds; logo.light: for white), otherwise
// a monogram in the brand colours.
async function drawIcons(pw) {
  const C = want.colors; const mono = (want.monogram || want.short.slice(0, 1)).slice(0, 3);
  const dataUri = (f) => { const b = fs.readFileSync(path.join(ROOT, f)); const ext = path.extname(f).slice(1).replace('jpg', 'jpeg').replace('svg', 'svg+xml'); return `data:image/${ext};base64,${b.toString('base64')}`; };
  const size = mono.length > 1 ? 200 / mono.length + 60 : 280;
  const monoSvg = (bg, fg, pad = 0) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><rect width="512" height="512" fill="${bg}"/><rect x="${96 + pad}" y="${96 + pad}" width="${320 - 2 * pad}" height="${320 - 2 * pad}" rx="${64 - pad / 2}" fill="${C.accent}"/><text x="256" y="${256 + size * 0.35 - pad * 0}" text-anchor="middle" font-family="${want.fonts.sans}, Arial, sans-serif" font-weight="600" font-size="${size - pad}" fill="#FFFFFF">${mono}</text></svg>`;
  const mark = want.logo && want.logo.mark ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><rect width="512" height="512" fill="${C.rail}"/><image href="${dataUri(want.logo.mark)}" x="0" y="0" width="512" height="512" preserveAspectRatio="xMidYMid meet"/></svg>` : monoSvg(C.rail, '#fff');
  const maskable = want.logo && want.logo.mark ? mark.replace('x="0" y="0" width="512" height="512" preserveAspectRatio', 'x="80" y="80" width="352" height="352" preserveAspectRatio') : monoSvg(C.rail, '#fff', 40);
  const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96"><text x="48" y="${mono.length > 1 ? 60 : 66}" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="${mono.length > 1 ? 88 / mono.length + 8 : 60}" fill="#FFFFFF">${mono}</text></svg>`;
  const light = want.logo && want.logo.light ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><rect width="512" height="512" fill="#FFFFFF"/><image href="${dataUri(want.logo.light)}" x="32" y="32" width="448" height="448" preserveAspectRatio="xMidYMid meet"/></svg>` : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><rect width="512" height="512" fill="#FFFFFF"/><rect x="156" y="96" width="200" height="200" rx="40" fill="${C.accent}"/><text x="256" y="${196 + (mono.length > 1 ? 120 / mono.length + 40 : 150) * 0.35}" text-anchor="middle" font-family="Arial, sans-serif" font-weight="600" font-size="${mono.length > 1 ? 120 / mono.length + 40 : 150}" fill="#FFFFFF">${mono}</text><text x="256" y="372" text-anchor="middle" font-family="Georgia, serif" font-size="${Math.min(52, 900 / want.company.length)}" fill="${C.ink}">${want.company.replace(/&/g, '&amp;')}</text></svg>`;
  const I = (f) => path.join(ROOT, 'icons', f);
  fs.writeFileSync(I('icon.svg'), mark); fs.writeFileSync(I('maskable.svg'), maskable); fs.writeFileSync(I('badge.svg'), badge);
  const b = await pw.chromium.launch({ executablePath: process.env.CHROME_BIN }); const p = await b.newPage();
  const shot = async (svg, out, px, fmt = 'png', transparent = false) => { await p.setViewportSize({ width: px, height: px }); await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace(/width="(512|96)" height="(512|96)"/, `width="${px}" height="${px}"`)}</body></html>`); await p.evaluate(() => document.fonts.ready); await p.screenshot({ path: out, type: fmt, clip: { x: 0, y: 0, width: px, height: px }, omitBackground: transparent }); };
  await shot(mark, I('icon-512.png'), 512); await shot(mark, I('icon-192.png'), 192); await shot(mark, I('apple-touch-icon.png'), 180);
  await shot(maskable, I('maskable-512.png'), 512); await shot(badge, I('badge-96.png'), 96, 'png', true);
  await shot(light, I('logo-light.png'), 512); await shot(light, path.join(ROOT, 'server/lib/logo-light.jpg'), 400, 'jpeg');
  await b.close(); console.log('Icons and logos redrawn.');
}
