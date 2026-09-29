// Research note review: the daily job raises a review task a week before the review date, the author cannot sign off
// their own note (in the app or by forcing it through sync), a colleague can, editing a signed-off note makes it a
// draft again, Mark reviewed moves the date on and closes the task, and the fact sheet says whether it is signed off.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');
const ROOT = path.resolve(__dirname, '..'); const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-')); const PORT = 3974;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = (n, ok, extra) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || extra === undefined ? '' : ' :: ' + JSON.stringify(extra).slice(0, 500))); if (!ok) process.exitCode = 1; };
const req = (method, p, { body, cookie, raw } = {}) => new Promise((resolve, reject) => { const data = body ? Buffer.from(JSON.stringify(body)) : null; const r = http.request({ host: '127.0.0.1', port: PORT, method, path: '/api/v1' + p, headers: { 'x-requested-with': 'brightday', ...(cookie ? { cookie } : {}), ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } }, (res) => { const ch = []; res.on('data', (c) => ch.push(c)); res.on('end', () => { const buf = Buffer.concat(ch); let b = {}; if (!raw) { try { b = JSON.parse(buf.toString() || '{}'); } catch { b = {}; } } resolve({ status: res.statusCode, headers: res.headers, body: b, buf }); }); }); r.on('error', reject); if (data) r.write(data); r.end(); });
const day = (n) => { const d = new Date(Date.now() + n * 864e5); const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
(async () => {
  process.env.DATA_DIR = DATA; process.env.ALLOW_UNENCRYPTED = '1';
  const D = require(ROOT + '/server/lib/db'); const auth = require(ROOT + '/server/lib/auth');
  D.users.insert({ id: 'u1', email: 'cc@x.com', name: 'Alex Morgan', role: 'Admin', status: 'Active', color: '#F50D74', pw_hash: auth.hashPassword('pw-1234567890') });
  D.users.insert({ id: 'u2', email: 'sam@x.com', name: 'Sam Rivera', role: 'Manager', status: 'Active', color: '#3A6FD8', pw_hash: auth.hashPassword('pw-1234567890') });
  D.users.insert({ id: 'u3', email: 'jordan@x.com', name: 'Jordan Lee', role: 'Manager', status: 'Active', color: '#B8801A', pw_hash: auth.hashPassword('pw-1234567890') });
  D.kvSet('settings', { notifyPrefs: { events: [] }, security: { mfaRequired: 'none' }, research: { starterAt: '2026-01-01T00:00:00', refreshMins: 1440 } });
  const base = { kind: 'ETF', cls: 'Australian equities', ex: 'ASX', ccy: 'AUD', price: 108.85, chg: 0.2, w52: [100, 115], mcap: '', pe: 19, yld: 2.9, frank: 75, mer: 0.07, beta: 1, ret: { m1: 1, m3: 2, y1: 4, y3: 11, y5: 7.5 }, vol: 12.8, mdd: -15, provider: 'yahoo' };
  D.putRecord('securities', { ...base, t: 'VAS.AX', name: 'Vanguard Australian Shares Index ETF', note: 'Core Australian equity exposure at a low fee.', noteBy: 'Sam Rivera', noteByUid: 'u2', noteAt: day(-300), noteStatus: 'Draft', noteReview: day(3) }, 'u2');
  D.putRecord('securities', { ...base, t: 'VGS.AX', name: 'Vanguard MSCI Index International Shares ETF', cls: 'International equities', note: 'Global core.', noteBy: 'Sam Rivera', noteByUid: 'u2', noteAt: day(-20), noteStatus: 'Approved', noteApprovedBy: 'u3', noteApprovedName: 'Jordan Lee', noteApprovedAt: day(-19), noteReview: day(200) }, 'u2');
  // The daily job, run in process.
  const jobs = require(ROOT + '/server/lib/jobs');
  const n1 = jobs.noteReviewTasks(); const n2 = jobs.noteReviewTasks(); const task = D.listCol('tasks').find((x) => x.src && x.src.startsWith('note-review:VAS.AX'));
  t('the job raises one review task for VAS.AX (due in 3 days), for the author, and none for VGS.AX (due in 200)', n1 === 1 && n2 === 0 && task && task.who.join() === 'u2' && task.due === day(3) && task.link === '#/security/VAS.AX', { n1, n2, task });
  D.db.close();
  const srv = spawn('node', ['index.js'], { cwd: ROOT + '/server', env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), ALLOW_UNENCRYPTED: '1', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (c) => (log += c)); srv.stderr.on('data', (c) => (log += c));
  for (let i = 0; i < 50 && !/\[boot\] /.test(log); i++) await sleep(100);
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined }); const errs = [];
  const login = async (email) => { const c = (await req('POST', '/auth/login', { body: { email, password: 'pw-1234567890' } })).headers['set-cookie'][0].split(';')[0]; const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } }); await ctx.addCookies([{ name: c.split('=')[0], value: c.split('=')[1], domain: '127.0.0.1', path: '/' }]); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept()); return { c, p }; };
  const open = async (p, h) => { await p.goto(`http://127.0.0.1:${PORT}/${h}`, { waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => typeof S === 'object' && S && S.loggedIn, null, { timeout: 15000 }); await sleep(700); };
  const secOf = async (c, tk) => ((await req('GET', '/sync?since=0', { cookie: c })).body.records || []).find((r) => r.col === 'securities' && r.id === tk).data;
  try {
    const rose = await login('sam@x.com');
    await open(rose.p, '#/security/VAS.AX'); const card = await rose.p.innerText('#note-card');
    t('the note card shows Draft, needs sign-off, and the review date coming up', /Draft · needs sign-off/i.test(card) && /Review by/i.test(card), card);
    t('the author sees no Sign off button, with the reason', !(await rose.p.$('[data-notesign]')) && /Someone other than you signs off/.test(card));
    await rose.p.evaluate(() => { const y = sec('VAS.AX'); Object.assign(y, { noteStatus: 'Approved', noteApprovedBy: S.me, noteApprovedName: 'Sam Rivera', noteApprovedAt: today() }); save(); }); await sleep(1800);
    t('forcing a self sign-off through sync is refused by the server', (await secOf(rose.c, 'VAS.AX')).noteStatus === 'Draft');
    await open(rose.p, '#/tasks'); t('the review task shows on the author\'s task list with a link to the security', /Review research note: VAS\.AX/.test(await rose.p.innerText('#content')) && !!(await rose.p.$('#content a[href="#/security/VAS.AX"]')));
    const cc = await login('cc@x.com');
    await open(cc.p, '#/research'); const tbl = await cc.p.innerText('#content');
    t('the research table flags VAS.AX (note unsigned) and offers the filter', /Note unsigned/i.test(tbl) && /1 research note to sign off or review/i.test(tbl), tbl.slice(0, 400));
    await cc.p.click('[data-notefilter]'); await sleep(300); t('the filter shows only the flagged security', (await cc.p.$$('#content tr[data-sec]')).length === 1);
    await cc.p.click('[data-notefilter]'); await sleep(200);
    const pdf1 = (await req('GET', '/research/securities/VAS.AX/factsheet.pdf', { cookie: cc.c, raw: true })).buf.toString('latin1');
    t('the fact sheet marks the note as a draft', /DRAFT, NOT SIGNED OFF/.test(pdf1));
    await open(cc.p, '#/security/VAS.AX'); await cc.p.click('[data-notesign="VAS.AX"]'); await sleep(1500);
    const s1 = await secOf(cc.c, 'VAS.AX');
    t('a colleague signs it off in their own name', s1.noteStatus === 'Approved' && s1.noteApprovedBy === 'u1' && s1.noteApprovedName === 'Alex Morgan', s1);
    t('the card now says Signed off by Alex Morgan', /Signed off by Alex Morgan/i.test(await cc.p.innerText('#note-card')));
    const pdf2 = (await req('GET', '/research/securities/VAS.AX/factsheet.pdf', { cookie: cc.c, raw: true })).buf.toString('latin1');
    t('the fact sheet says signed off by Alex Morgan', /SIGNED OFF BY ALEX MORGAN/.test(pdf2));
    await cc.p.click('[data-notereviewed="VAS.AX"]'); await sleep(1500);
    const s2 = await secOf(cc.c, 'VAS.AX'); const tasks = ((await req('GET', '/sync?since=0', { cookie: cc.c })).body.records || []).filter((r) => r.col === 'tasks' && r.data && /Review research note: VAS/.test(r.data.title));
    t('Mark reviewed moves the review a year on, records who, keeps the sign-off, and closes the task', s2.noteReview === day(365) && s2.noteReviewedBy === 'Alex Morgan' && s2.noteStatus === 'Approved' && tasks.every((r) => r.data.done), { s2, tasks: tasks.map((r) => r.data.done) });
    await open(rose.p, '#/security/VAS.AX'); await rose.p.click('#note-card [data-research="edit"]'); await rose.p.fill('#mform [name=note]', 'Core Australian equity exposure at a low fee. Updated view.'); await rose.p.click('#mform [type=submit]'); await sleep(1500);
    const s3 = await secOf(rose.c, 'VAS.AX');
    t('editing the text of a signed-off note makes it a draft again', s3.noteStatus === 'Draft' && !s3.noteApprovedBy && /Updated view/.test(s3.note), s3);
    const bad = ((await rose.p.innerText('#content')).match(/NaN|undefined/g) || []); t('no NaN or undefined', !bad.length, bad);
    t('no page errors', errs.length === 0, errs);
  } finally { await b.close(); srv.kill('SIGTERM'); }
  if (process.exitCode) console.log(log.split('\n').filter((l) => !/Experimental|trace-warnings/.test(l)).slice(-15).join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
