// Waiting on us and response times: which deals show as waiting (contact wrote last, no email or call since),
// Mine and Team, opening one on its Email tab, "No reply needed" and its reset, the Reports response-time card,
// and the morning briefing naming the oldest waiting email.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');
const ROOT = path.resolve(__dirname, '..'); const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'follow-')); const PORT = 3973;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = (n, ok, extra) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || extra === undefined ? '' : ' :: ' + JSON.stringify(extra).slice(0, 500))); if (!ok) process.exitCode = 1; };
const req = (method, p, { body, cookie } = {}) => new Promise((resolve, reject) => { const data = body ? Buffer.from(JSON.stringify(body)) : null; const r = http.request({ host: '127.0.0.1', port: PORT, method, path: '/api/v1' + p, headers: { 'x-requested-with': 'acme', ...(cookie ? { cookie } : {}), ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } }, (res) => { let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => { let b; try { b = JSON.parse(s || '{}'); } catch { b = {}; } resolve({ status: res.statusCode, headers: res.headers, body: b }); }); }); r.on('error', reject); if (data) r.write(data); r.end(); });
const ago = (h) => { const d = new Date(Date.now() - h * 36e5); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
(async () => {
  process.env.DATA_DIR = DATA; process.env.ALLOW_UNENCRYPTED = '1';
  const D = require(ROOT + '/server/lib/db'); const auth = require(ROOT + '/server/lib/auth');
  D.users.insert({ id: 'u1', email: 'cc@x.com', name: 'Alex Morgan', role: 'Admin', status: 'Active', color: '#3559E0', pw_hash: auth.hashPassword('pw-1234567890') });
  D.users.insert({ id: 'u2', email: 'sam@x.com', name: 'Sam Smith', role: 'Client manager', status: 'Active', color: '#3A6FD8' });
  D.kvSet('settings', { notifyPrefs: { events: [] }, security: { mfaRequired: 'none' }, research: { starterAt: '2026-01-01T00:00:00', refreshMins: 1440 } });
  D.kvSet('stages', [{ id: 'new', name: 'New lead' }, { id: 'prop', name: 'Proposal sent' }, { id: 'won', name: 'Won', closed: true }]);
  const deal = (id, owner, practice, stage = 'prop', extra = {}) => { D.putRecord('deals', { id, practice, contact: practice.split(' ')[0] + ' Contact', email: `c${id}@x.com`, stage, value: 10000, owner, created: ago(24 * 20).slice(0, 10), source: 'website', ...extra }, 'u1'); };
  const thread = (id, dealId, subject, msgs) => D.putRecord('threads', { id, deal: dealId, from: 'Contact', addr: `c${dealId}@x.com`, subject, folder: 'inbox', unread: false, at: msgs[msgs.length - 1].at, msgs }, 'system');
  const created = (dealId, h) => D.putRecord('activity', { id: 1000 + dealId, deal: dealId, type: 'created', who: '', text: 'Lead created', at: ago(h) }, 'system');
  deal(1, 'u1', 'Alpha Advisers'); thread(101, 1, 'Proposal', [{ out: true, at: ago(240), body: 'Proposal attached' }, { out: false, at: ago(72), body: 'Question on fees' }]); created(1, 250);
  deal(2, 'u2', 'Bravo Wealth'); thread(102, 2, 'Intro', [{ out: false, at: ago(5), body: 'Hello' }]); created(2, 6);
  deal(3, 'u1', 'Charlie Partners'); thread(103, 3, 'Timing', [{ out: false, at: ago(48), body: 'When can we start?' }]); created(3, 100);
  D.putRecord('calls', { id: 1, deal: 3, direction: 'out', who: 'u1', at: ago(24), duration: 300, status: 'completed' }, 'system');
  deal(4, 'u1', 'Delta Group'); thread(104, 4, 'Fees', [{ out: false, at: ago(96), body: 'Fees?' }, { out: true, at: ago(72), body: 'Here they are' }]); created(4, 120);
  deal(5, 'u1', 'Echo Closed', 'won'); thread(105, 5, 'Thanks', [{ out: false, at: ago(30), body: 'Thanks!' }]);
  deal(6, 'u1', 'Foxtrot Co', 'prop', { noReplyAt: ago(10) }); thread(106, 6, 'FYI', [{ out: false, at: ago(10), body: 'FYI only' }]);
  D.db.close();
  const srv = spawn('node', ['index.js'], { cwd: ROOT + '/server', env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), ALLOW_UNENCRYPTED: '1', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (c) => (log += c)); srv.stderr.on('data', (c) => (log += c));
  for (let i = 0; i < 50 && !/\[boot\] /.test(log); i++) await sleep(100);
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined }); const errs = [];
  try {
    const c = (await req('POST', '/auth/login', { body: { email: 'cc@x.com', password: 'pw-1234567890' } })).headers['set-cookie'][0].split(';')[0];
    const brief = (await req('POST', '/brief/refresh', { cookie: c })).body;
    t('the morning briefing leads with the oldest email waiting on a reply (Alpha, 3 days)', /2 client emails are waiting on a reply; the oldest is Alpha Advisers \(3 days\)/.test(brief.text || '') && (brief.actions || []).some((a) => a.url === '#/deal/1'), brief);
    const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } }); await ctx.addCookies([{ name: c.split('=')[0], value: c.split('=')[1], domain: '127.0.0.1', path: '/' }]);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    const card = () => p.innerText('#waiting-card');
    await p.goto(`http://127.0.0.1:${PORT}/#/dashboard`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => typeof S === 'object' && S && S.loggedIn && document.querySelector('#waiting-card'), null, { timeout: 15000 }); await sleep(500);
    const mine = await card();
    t('Mine: only Alpha Advisers waits (3 days); the answered, called, closed, dismissed and other-owner deals do not', /Alpha Advisers/.test(mine) && /3 days/.test(mine) && !/Bravo|Charlie|Delta|Echo|Foxtrot/.test(mine), mine);
    await p.click('#waiting-card [data-waitteam="1"]'); await sleep(300); const team = await card();
    t('Team adds Sam\'s Bravo Wealth (5 h) with the owner named, oldest first', /Alpha Advisers[\s\S]*Bravo Wealth/.test(team) && /Sam Smith/.test(team) && /5 h/.test(team), team);
    t('the count chip shows 2', /Waiting on us\s*2/i.test(team), team.slice(0, 60));
    await p.click('#waiting-card [data-waitdeal="1"]'); await sleep(700);
    t('opening it goes to the deal on its Email tab with the Waiting on us banner', (await p.evaluate(() => location.hash)) === '#/deal/1' && /Waiting on us/i.test(await p.innerText('#content')) && /emailed/.test(await p.innerText('#content')));
    await p.click('#content [data-noreply="1"]'); await sleep(1500);
    const d1 = ((await req('GET', '/sync?since=0', { cookie: c })).body.records || []).find((r) => r.col === 'deals' && r.id === '1').data;
    t('No reply needed saves on the deal and removes the banner', !!d1.noReplyAt && !/Waiting on us/i.test(await p.innerText('#content')));
    await p.evaluate(() => { location.hash = '#/dashboard'; }); await sleep(500);
    t('and Alpha leaves the list', !/Alpha Advisers/.test(await card()));
    await p.evaluate(() => { const th = S.threads.find((x) => x.id === 101); th.msgs.push({ out: false, at: now(), body: 'One more question' }); save(); route(); }); await sleep(500);
    t('a new email from the contact puts it back', /Alpha Advisers/.test(await card()));
    await p.evaluate(() => { S.ui.reportRange = '90'; location.hash = '#/reports'; }); await sleep(800);
    const rc = await p.evaluate(() => [...document.querySelectorAll('#response-card tbody tr')].map((tr) => [...tr.children].map((td) => td.innerText.trim())));
    const cc = rc.find((r) => r[0] === 'Alex Morgan'); const rs = rc.find((r) => r[0] === 'Sam Smith'); const tm = rc.find((r) => r[0] === 'Team');
    t('Reports shows response times per owner and a team row', !!cc && !!rs && !!tm, rc);
    t('Alex: two client emails answered (Charlie by call, Delta by email) with a median of 24 h, all within 24 h, one waiting now', cc && cc[5] === '2' && cc[6] === '24 h' && cc[7] === '100%' && cc[8] === '1', cc);
    t('Sam: one new lead not yet contacted, one email waiting', rs && rs[1] === '1' && rs[4] === '1' && rs[8] === '1', rs);
    const monthOk = await p.evaluate(() => { const d = new Date(); return [...document.querySelectorAll('#content .card')].some((c) => /Leads by month/.test(c.innerText) && c.innerText.includes(d.toLocaleDateString('en-AU', { month: 'short' }))); });
    t('the 90-day report covers the current month (dates no longer fixed to the sample period)', monthOk);
    const bad = ((await p.innerText('#content')).match(/NaN|undefined/g) || []); t('no NaN or undefined on Reports', !bad.length, bad);
    t('no page errors', errs.length === 0, errs);
  } finally { await b.close(); srv.kill('SIGTERM'); }
  if (process.exitCode) console.log(log.split('\n').filter((l) => !/Experimental|trace-warnings/.test(l)).slice(-15).join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
