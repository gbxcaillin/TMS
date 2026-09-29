// Morningstar reference data without the network: upload two sample exports in Settings, a seeded ETF picks up its
// fee and Morningstar block, an unlisted fund is found by APIR code and added, a fee typed in the app wins over a
// re-import, and a file that is not an export is refused. Fixtures hold made-up funds in the Morningstar layout.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');
const ROOT = path.resolve(__dirname, '..'); const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'refd-')); const PORT = 3971; const FX = path.join(__dirname, 'fixtures');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = (n, ok, extra) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || extra === undefined ? '' : ' :: ' + JSON.stringify(extra).slice(0, 400))); if (!ok) process.exitCode = 1; };
const req = (method, p, { body, cookie } = {}) => new Promise((resolve, reject) => { const data = body ? Buffer.from(JSON.stringify(body)) : null; const r = http.request({ host: '127.0.0.1', port: PORT, method, path: '/api/v1' + p, headers: { 'x-requested-with': 'acme', ...(cookie ? { cookie } : {}), ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } }, (res) => { let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => { let b; try { b = JSON.parse(s || '{}'); } catch { b = { raw: s.slice(0, 50) }; } resolve({ status: res.statusCode, headers: res.headers, body: b }); }); }); r.on('error', reject); if (data) r.write(data); r.end(); });
(async () => {
  process.env.DATA_DIR = DATA; process.env.ALLOW_UNENCRYPTED = '1';
  const D = require(ROOT + '/server/lib/db'); const auth = require(ROOT + '/server/lib/auth');
  D.users.insert({ id: 'u1', email: 'cc@x.com', name: 'Alex Morgan', role: 'Admin', status: 'Active', color: '#3559E0', pw_hash: auth.hashPassword('pw-1234567890') });
  D.kvSet('settings', { notifyPrefs: { events: [] }, security: { mfaRequired: 'none' }, research: { starterAt: '2026-09-28T00:00:00', refreshMins: 1440 } });
  // A listed ETF already in the library, as the price refresh would have left it (no fee from the provider).
  D.putRecord('securities', { t: 'TSTA.AX', name: 'Sample Australian Shares Index ETF', kind: 'ETF', cls: 'Australian equities', ex: 'ASX', ccy: 'AUD', price: 108.85, chg: 0.2, w52: [100, 115], mcap: '', pe: null, yld: 2.9, frank: null, mer: null, beta: 1, ret: { m1: 1, m3: 2, y1: 4, y3: 11, y5: 7.5 }, vol: 12.8, mdd: -15, provider: 'yahoo' }, 'market');
  D.putRecord('securities', { t: 'CBA.AX', name: 'Commonwealth Bank of Australia', kind: 'Share', cls: 'Australian equities', ex: 'ASX', ccy: 'AUD', price: 150, chg: 0, w52: [120, 160], mcap: '', pe: 20, yld: 3.3, frank: 100, mer: null, beta: 0.8, ret: { m1: 1, m3: 2, y1: 4, y3: 11, y5: 7.5 }, vol: 18, mdd: -20, provider: 'yahoo' }, 'market');
  D.db.close();
  const srv = spawn('node', ['index.js'], { cwd: ROOT + '/server', env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), ALLOW_UNENCRYPTED: '1', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (c) => (log += c)); srv.stderr.on('data', (c) => (log += c));
  for (let i = 0; i < 50 && !/\[boot\] /.test(log); i++) await sleep(100);
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined }); const errs = [];
  try {
    const c = (await req('POST', '/auth/login', { body: { email: 'cc@x.com', password: 'pw-1234567890' } })).headers['set-cookie'][0].split(';')[0];
    const secOf = async (tk) => ((await req('GET', '/sync?since=0', { cookie: c })).body.records || []).find((x) => x.col === 'securities' && x.id === tk && x.data)?.data;
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } }); await ctx.addCookies([{ name: c.split('=')[0], value: c.split('=')[1], domain: '127.0.0.1', path: '/' }]);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
    const content = () => p.innerText('#content'); const go = async (h) => { await p.evaluate((x) => (location.hash = x), h); await sleep(600); };
    const clean = async (l) => { const bad = ((await content()).match(/NaN|undefined|\[object/g) || []); t(l + ': no NaN/undefined', !bad.length, bad); };
    await p.goto(`http://127.0.0.1:${PORT}/#/settings/research`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => typeof S === 'object' && S && S.loggedIn, null, { timeout: 15000 }); await sleep(1200);
    t('Settings, Research shows the empty Reference data card', /No reference files yet/.test(await content()));
    await p.setInputFiles('#ref-file', [path.join(FX, 'morningstar-etfs-sample.csv'), path.join(FX, 'morningstar-funds-sample.csv')]);
    await p.waitForFunction(() => REF.data && REF.data.files && REF.data.files.length === 2, null, { timeout: 30000 }); await sleep(1500);
    t('both sample exports imported and listed', /morningstar-etfs-sample\.csv/.test(await content()) && /morningstar-funds-sample\.csv/.test(await content()));
    const a = await secOf('TSTA.AX'); const cba = await secOf('CBA.AX');
    t('the ETF in the library gets its fee and Morningstar block', a.mer === 0.07 && a.merSrc === 'morningstar' && a.ms.stars === 4 && a.ms.sd3 === 10.69 && a.ms.medal === 'Bronze', a && { mer: a.mer, ms: a.ms });
    t('a share not in the exports is untouched', !cba.ms && !cba.merSrc);
    await go('#/security/TSTA.AX'); t('security page shows the Morningstar card and the fee source', /MORNINGSTAR/i.test(await content()) && /0\.07% p\.a\.\s*Morningstar/i.test(await content()));
    await clean('ETF page');
    await go('#/research'); await p.click('#content .page-head [data-lookup]'); await p.fill('#lk-q', 'TST0111AU'); await p.waitForSelector('.lk-row[data-lk="TST0111AU"]', { timeout: 20000 });
    t('lookup finds the unlisted fund by APIR code with its fee', /fee 0\.29%/.test(await p.innerText('.lk-row[data-lk="TST0111AU"]')));
    await p.click('.lk-row[data-lk="TST0111AU"]'); await p.waitForFunction(() => !!sec('TST0111AU'), null, { timeout: 20000 }); await sleep(800);
    const f = await secOf('TST0111AU');
    t('the unlisted fund is added from the export with fee, returns and 3y SD', f && f.provider === 'reference' && f.kind === 'Managed fund' && f.mer === 0.29 && f.ret.y5 === 8.42 && f.vol === 8.52 && f.cls === 'Multi‑asset', f);
    t('its page says there is no daily price history', /not listed on an exchange/.test(await content()));
    await clean('fund page');
    await go('#/security/TSTA.AX'); await p.click('#content .toolbar [data-sec-edit]'); await p.fill('#mform [name=mer]', '0.05'); await p.click('#mform [type=submit]'); await sleep(1500);
    await go('#/settings/research'); await p.setInputFiles('#ref-file', [path.join(FX, 'morningstar-etfs-sample.csv')]); await sleep(3000);
    const a2 = await secOf('TSTA.AX'); t('a fee typed in the app survives re-importing the export', a2.mer === 0.05 && a2.merSrc === 'manual' && a2.ms.fee === 0.07, { mer: a2.mer, src: a2.merSrc });
    const r = await p.evaluate(async () => { try { await api('research/refdata/upload?name=bad.csv', { method: 'POST', body: new Blob(['a,b,c\n1,2,3\n']) }); return 'accepted'; } catch (e) { return e.status + ' ' + e.message; } });
    t('a file that is not a Morningstar export is refused with a clear message', /^400 This is not a Morningstar/.test(r), r);
    t('no page errors', errs.length === 0, errs);
  } finally { await b.close(); srv.kill('SIGTERM'); }
  if (process.exitCode) console.log(log.split('\n').filter((l) => !/Experimental|trace-warnings/.test(l)).slice(-15).join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
