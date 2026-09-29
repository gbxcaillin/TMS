// Archive of closed deals: old won/lost deals reach the browser as stubs without their history, recent and open
// deals are untouched, opening an archived deal loads its history without pushing anything back, a change made to a
// stub never wipes the full record, reports still count archived deals, members cannot fetch deals they cannot see,
// and archiving can be turned off.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');
const ROOT = path.resolve(__dirname, '..'); const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-')); const PORT = 3975;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = (n, ok, extra) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || extra === undefined ? '' : ' :: ' + JSON.stringify(extra).slice(0, 500))); if (!ok) process.exitCode = 1; };
const req = (method, p, { body, cookie } = {}) => new Promise((resolve, reject) => { const data = body ? Buffer.from(JSON.stringify(body)) : null; const r = http.request({ host: '127.0.0.1', port: PORT, method, path: '/api/v1' + p, headers: { 'x-requested-with': 'brightday', ...(cookie ? { cookie } : {}), ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } }, (res) => { let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => { let b; try { b = JSON.parse(s || '{}'); } catch { b = {}; } resolve({ status: res.statusCode, headers: res.headers, body: b, len: s.length }); }); }); r.on('error', reject); if (data) r.write(data); r.end(); });
const day = (n) => { const d = new Date(Date.now() + n * 864e5); const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
(async () => {
  process.env.DATA_DIR = DATA; process.env.ALLOW_UNENCRYPTED = '1';
  const D = require(ROOT + '/server/lib/db'); const auth = require(ROOT + '/server/lib/auth');
  D.users.insert({ id: 'u1', email: 'cc@x.com', name: 'Alex Morgan', role: 'Admin', status: 'Active', color: '#F50D74', pw_hash: auth.hashPassword('pw-1234567890') });
  D.users.insert({ id: 'u2', email: 'mem@x.com', name: 'Priya Member', role: 'Client manager', status: 'Active', color: '#3A6FD8', pw_hash: auth.hashPassword('pw-1234567890') });
  D.kvSet('settings', { notifyPrefs: { events: [] }, security: { mfaRequired: 'none' }, research: { starterAt: '2026-01-01T00:00:00', refreshMins: 1440 } });
  D.kvSet('stages', [{ id: 'new', name: 'New lead' }, { id: 'prop', name: 'Proposal sent' }, { id: 'won', name: 'Won', closed: 'won' }, { id: 'lost', name: 'Lost', closed: 'lost' }]);
  const deal = (id, stage, extra) => D.putRecord('deals', { id, practice: 'Practice ' + id, contact: 'Contact ' + id, email: `c${id}@x.com`, stage, value: 1000 * id, owner: 'u1', created: day(-300), source: 'website', notes: 'Long notes '.repeat(50), service: 'Advice', ...extra }, 'u1');
  deal(1, 'won', { close: day(-200) }); deal(2, 'lost', { close: day(-30) }); deal(3, 'prop', { close: day(20) }); deal(4, 'won', {});
  D.putRecord('changes', { id: 1, entity: 'deal', ref: 4, at: day(-120) + 'T10:00', who: 'u1', field: 'Stage', from: 'Proposal sent', to: 'Won' }, 'u1');
  for (const id of [1, 2]) {
    for (let i = 0; i < 20; i++) D.putRecord('activity', { id: id * 1000 + i, deal: id, type: 'note', who: 'u1', text: `Note ${i} on deal ${id}`, at: day(-250 + i) + 'T09:00' }, 'u1');
    D.putRecord('threads', { id: 500 + id, deal: id, from: 'Contact', addr: `c${id}@x.com`, subject: 'Engagement letter ' + id, folder: 'inbox', unread: false, at: day(-210) + 'T09:00', msgs: [{ out: false, at: day(-210) + 'T09:00', body: 'Signed and returned.' }] }, 'system');
    D.putRecord('files', { id: 700 + id, deal: id, name: `Letter ${id}.pdf`, size: '100 KB', by: 'u1', at: day(-210), kind: 'PDF' }, 'u1');
  }
  D.db.close();
  const srv = spawn('node', ['index.js'], { cwd: ROOT + '/server', env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), ALLOW_UNENCRYPTED: '1', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (c) => (log += c)); srv.stderr.on('data', (c) => (log += c));
  for (let i = 0; i < 50 && !/\[boot\] /.test(log); i++) await sleep(100);
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined }); const errs = [];
  try {
    const c = (await req('POST', '/auth/login', { body: { email: 'cc@x.com', password: 'pw-1234567890' } })).headers['set-cookie'][0].split(';')[0];
    const boot = await req('GET', '/bootstrap', { cookie: c }); const st = boot.body.state;
    const d1 = st.deals.find((d) => d.id === 1), d2 = st.deals.find((d) => d.id === 2), d3 = st.deals.find((d) => d.id === 3), d4 = st.deals.find((d) => d.id === 4);
    t('a deal won 200 days ago arrives as a stub: name, stage, value, owner kept, notes left out', d1._arch && d1.practice === 'Practice 1' && d1.stage === 'won' && d1.value === 1000 && d1.owner === 'u1' && !d1.notes, d1);
    t('a deal won 120 days ago with no close date (from its stage change) is archived too', d4 && d4._arch);
    t('a deal lost 30 days ago and an open deal are sent in full', !d2._arch && d2.notes && !d3._arch && d3.notes);
    t('the archived deal\'s timeline, conversation and files stay on the server; the recent deal\'s are sent', !st.activity.some((a) => a.deal === 1) && !st.threads.some((x) => x.deal === 1) && !st.files.some((f) => f.deal === 1) && st.activity.filter((a) => a.deal === 2).length === 20 && st.threads.some((x) => x.deal === 2));
    const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } }); await ctx.addCookies([{ name: c.split('=')[0], value: c.split('=')[1], domain: '127.0.0.1', path: '/' }]);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`http://127.0.0.1:${PORT}/#/pipeline`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => typeof S === 'object' && S && S.loggedIn, null, { timeout: 15000 }); await sleep(800);
    t('the pipeline still lists the archived deal', /Practice 1/.test(await p.innerText('#content')));
    await p.evaluate(() => { location.hash = '#/deal/1'; }); await p.waitForFunction(() => { const d = deal(1); return d && !d._arch; }, null, { timeout: 10000 }); await sleep(600);
    const got = await p.evaluate(() => ({ notes: !!deal(1).notes, acts: S.activity.filter((a) => a.deal === 1 && /^Note /.test(a.text)).length, threads: S.threads.filter((x) => x.deal === 1).length, files: S.files.filter((f) => f.deal === 1).length }));
    t('opening it loads the full record and its history', got.notes && got.acts === 20 && got.threads === 1 && got.files === 1, got);
    await p.evaluate(() => { S.ui.dealTab[1] = 'activity'; route(); }); await sleep(300);
    t('its Activity tab shows the history, newest first', await p.evaluate(() => { const txt = document.querySelector('#content').innerText; return txt.indexOf('Note 19 on deal 1') >= 0 && txt.indexOf('Note 19 on deal 1') < txt.indexOf('Note 0 on deal 1'); }));
    await sleep(800); t('loading it pushed nothing back (nothing waiting to sync)', await p.evaluate(() => !NET.dirty && !NET.busy));
    // A change made to a stub: reopen deal 4 from a fresh page where it is still a stub.
    const p2 = await ctx.newPage(); p2.on('pageerror', (e) => errs.push(e.message));
    await p2.goto(`http://127.0.0.1:${PORT}/#/pipeline`, { waitUntil: 'domcontentloaded' }); await p2.waitForFunction(() => typeof S === 'object' && S && S.loggedIn, null, { timeout: 15000 }); await sleep(500);
    await p2.evaluate(() => { moveStage(4, 'prop'); save(); }); await sleep(2000);
    const full4 = ((await req('GET', '/sync?since=0', { cookie: c })).body.records || []).find((r) => r.col === 'deals' && r.id === '4').data;
    t('moving a stub back to an open stage keeps its full record on the server (notes intact)', full4.stage === 'prop' && /Long notes/.test(full4.notes || '') && !full4._arch, { stage: full4.stage, notes: (full4.notes || '').slice(0, 20), arch: full4._arch });
    await sleep(1500); t('and the browser then receives it in full', await p2.evaluate(() => !deal(4)._arch && !!deal(4).notes));
    await p2.evaluate(() => { S.ui.reportRange = 'all'; location.hash = '#/reports'; }); await sleep(600);
    t('Reports all time still counts the archived won deal', await p2.evaluate(() => /Won revenue|won/i.test(document.querySelector('#content').innerText)) && await p2.evaluate(() => S.deals.some((d) => d.id === 1 && d.stage === 'won')));
    // Members cannot pull a deal they cannot see.
    const cm = (await req('POST', '/auth/login', { body: { email: 'mem@x.com', password: 'pw-1234567890' } })).headers['set-cookie'][0].split(';')[0];
    t('a member cannot fetch an archived deal they do not own', (await req('GET', '/archive/deal/1', { cookie: cm })).status === 403);
    // Turn archiving off.
    await p2.evaluate(() => { location.hash = '#/settings/stages'; }); await sleep(500);
    t('Settings, Stages shows the archive setting with the count', /Archive closed deals/i.test(await p2.innerText('#content')) && /1 deals/.test(await p2.innerText('#content')));
    await p2.selectOption('#archive-days', '0'); await sleep(1500);
    const boot2 = await req('GET', '/bootstrap', { cookie: c });
    t('with archiving off, the next sign-in sends every deal in full', !boot2.body.state.deals.some((d) => d._arch) && boot2.body.state.activity.some((a) => a.deal === 1));
    t('no page errors', errs.length === 0, errs);
  } finally { await b.close(); srv.kill('SIGTERM'); }
  if (process.exitCode) console.log(log.split('\n').filter((l) => !/Experimental|trace-warnings/.test(l)).slice(-15).join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
