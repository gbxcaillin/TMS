// End to end: boot the real server, sign in two users, hold the live stream open as one and post a chat
// message as the other; measure how quickly the stream announces it and that a pull returns the message.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'live-e2e-'));
const PORT = 3977;
const t = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) process.exitCode = 1; };
const req = (method, p, { body, cookie, headers = {} } = {}) => new Promise((resolve, reject) => {
  const data = body ? Buffer.from(JSON.stringify(body)) : null;
  const r = http.request({ host: '127.0.0.1', port: PORT, method, path: '/api/v1' + p, headers: { 'x-requested-with': 'acme', ...(cookie ? { cookie } : {}), ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}), ...headers } }, (res) => {
    let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(s); } catch (_) { } resolve({ status: res.statusCode, headers: res.headers, body: j, raw: s }); });
  });
  r.on('error', reject); if (data) r.write(data); r.end();
});
const login = async (email) => { const r = await req('POST', '/auth/login', { body: { email, password: 'pw-1234567890' } }); if (r.status !== 200) throw new Error('login ' + email + ' ' + r.status + ' ' + r.raw); return r.headers['set-cookie'][0].split(';')[0]; };
// Open the live stream and hand back a way to await the next "rev" event.
function stream(cookie) {
  const s = { events: [], waiters: [], open: false, closed: false, status: 0 };
  const r = http.request({ host: '127.0.0.1', port: PORT, method: 'GET', path: '/api/v1/live', headers: { cookie, accept: 'text/event-stream' } }, (res) => {
    s.status = res.statusCode; s.type = res.headers['content-type']; let buf = '';
    res.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n\n')) >= 0) { const block = buf.slice(0, i); buf = buf.slice(i + 2); const m = /event: (\w+)\ndata: (.*)/.exec(block); if (m) { const ev = { event: m[1], data: m[2], at: Date.now() }; s.events.push(ev); s.waiters.splice(0).forEach((w) => w(ev)); } else if (/^: ping/.test(block)) s.pings = (s.pings || 0) + 1; } });
    res.on('end', () => { s.closed = true; });
  });
  r.on('error', () => { s.closed = true; }); r.end();
  s.next = (ms = 2000) => new Promise((res) => { const to = setTimeout(() => res(null), ms); s.waiters.push((ev) => { clearTimeout(to); res(ev); }); });
  s.end = () => r.destroy();
  return s;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  // Seed two non-admin users (admins need MFA before /sync) and a settings doc, then boot the server on that data.
  process.env.DATA_DIR = DATA; process.env.ALLOW_UNENCRYPTED = '1';
  const D = require(require('node:path').resolve(__dirname, '..') + '/server/lib/db'); const auth = require(require('node:path').resolve(__dirname, '..') + '/server/lib/auth');
  for (const [id, email, name] of [['u1', 'jordan@x.com', 'Jordan Lee'], ['u2', 'sam@x.com', 'Sam Rivera']]) D.users.insert({ id, email, name, role: 'Manager', status: 'Active', color: '#3559E0', pw_hash: auth.hashPassword('pw-1234567890') });
  D.kvSet('settings', { notifyPrefs: { events: [], quietFrom: '', quietTo: '' }, security: { mfaRequired: 'none' } });
  D.db.close();
  const srv = spawn('node', ['index.js'], { cwd: require('node:path').resolve(__dirname, '..') + '/server', env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), ALLOW_UNENCRYPTED: '1', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (c) => (log += c)); srv.stderr.on('data', (c) => (log += c));
  for (let i = 0; i < 50 && !/\[boot\] /.test(log); i++) await sleep(100);
  try {
    t('server booted', /\[boot\] /.test(log));
    const anon = await req('GET', '/live');
    t('live stream needs a session (401 when signed out)', anon.status === 401);
    const c1 = await login('jordan@x.com'), c2 = await login('sam@x.com');
    const boot2 = await req('GET', '/bootstrap', { cookie: c2 });
    const rev0 = boot2.body.rev;
    const s2 = stream(c2);
    const first = await s2.next();
    t('stream opens with the current revision', s2.status === 200 && /text\/event-stream/.test(s2.type) && first && first.event === 'rev' && +first.data === rev0);
    // Jordan opens a DM and sends a message, exactly as the app does in one sync.
    const t0 = Date.now();
    const p = s2.next(3000);
    const sync = await req('POST', '/sync', { cookie: c1, body: { base: rev0, ops: [{ col: 'rooms', id: 'dm_u1_u2', data: { id: 'dm_u1_u2', name: '', kind: 'dm', members: ['u1', 'u2'] } }, { col: 'messages', id: '1', data: { id: 1, room: 'dm_u1_u2', who: 'u1', at: '2026-09-28T10:00', text: 'Can you check the Harbourline scope?', read: ['u1'], emailed: [] } }], kv: {} } });
    const ev = await p;
    const latency = ev ? ev.at - t0 : -1;
    t('sync accepted', sync.status === 200);
    t('one rev event for the whole sync, within a second (' + latency + ' ms)', ev && ev.event === 'rev' && +ev.data > rev0 && latency >= 0 && latency < 1000 && s2.events.filter((e) => e.event === 'rev').length === 2);
    const pull = await req('GET', '/sync?since=' + rev0, { cookie: c2 });
    const msg = (pull.body.records || []).find((r) => r.col === 'messages');
    const bell = (pull.body.records || []).find((r) => r.col === 'notifs' && r.data && r.data.to && r.data.to.includes('u2'));
    t('the pull that follows carries the message and the bell notice with a deep link', !!msg && msg.data.text === 'Can you check the Harbourline scope?' && !!bell && bell.data.go === '#/chat/dm_u1_u2' && /Jordan sent you a message/.test(bell.data.text));
    t('server log shows no push failure (no devices enrolled, nothing to send)', !/failed/.test(log));
    // Sam marks it read: another event, still coalesced to one.
    const p2 = s2.next(2000);
    await req('POST', '/sync', { cookie: c2, body: { base: +ev.data, ops: [{ col: 'messages', id: '1', data: { ...msg.data, read: ['u1', 'u2'] } }], kv: {} } });
    const ev2 = await p2;
    t('a second change is announced too', ev2 && +ev2.data > +ev.data);
    // The stream stays open and quiet when nothing changes.
    const quiet = await s2.next(1500);
    t('no events while nothing changes; stream still open', quiet === null && !s2.closed);
    // A second tab for the same user gets the same event; both count in admin stats.
    const s2b = stream(c2); await s2b.next();
    const st = await req('GET', '/live', { cookie: 'acme_session=nope' });
    t('bad cookie rejected', st.status === 401);
    const pA = s2.next(2000), pB = s2b.next(2000);
    await req('POST', '/sync', { cookie: c1, body: { base: 0, ops: [{ col: 'tasks', id: '1', data: { id: 1, title: 'Send the scope', who: ['u2'], by: 'u1', done: false } }], kv: {} } });
    const [a, b] = await Promise.all([pA, pB]);
    t('both tabs of one user hear the same revision', a && b && a.data === b.data);
    s2.end(); s2b.end(); await sleep(200);
    const h = await req('GET', '/health');
    t('server healthy after streams closed', h.status === 200 && h.body.ok);
  } finally { srv.kill('SIGTERM'); }
  if (process.exitCode) console.log(log.slice(-1500));
})().catch((e) => { console.error(e); process.exit(1); });
