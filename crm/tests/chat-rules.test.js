// Server rules for chat messages: only the sender edits or recalls; sender or admin deletes; anyone marks read.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'msg-rules-'));
const PORT = 3981;
const t = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const req = (method, p, { body, cookie } = {}) => new Promise((resolve, reject) => {
  const data = body ? Buffer.from(JSON.stringify(body)) : null;
  const r = http.request({ host: '127.0.0.1', port: PORT, method, path: '/api/v1' + p, headers: { 'x-requested-with': 'brightday', ...(cookie ? { cookie } : {}), ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } }, (res) => { let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(s); } catch (_) { } resolve({ status: res.statusCode, headers: res.headers, body: j }); }); });
  r.on('error', reject); if (data) r.write(data); r.end();
});
const login = async (email) => (await req('POST', '/auth/login', { body: { email, password: 'pw-1234567890' } })).headers['set-cookie'][0].split(';')[0];
(async () => {
  process.env.DATA_DIR = DATA; process.env.ALLOW_UNENCRYPTED = '1';
  const D = require(require('node:path').resolve(__dirname, '..') + '/server/lib/db'); const auth = require(require('node:path').resolve(__dirname, '..') + '/server/lib/auth');
  for (const [id, email, name, role] of [['u1', 'jordan@x.com', 'Jordan Lee', 'Manager'], ['u2', 'sam@x.com', 'Sam Rivera', 'Manager'], ['u3', 'cc@x.com', 'Alex Morgan', 'Admin']]) D.users.insert({ id, email, name, role, status: 'Active', color: '#F50D74', pw_hash: auth.hashPassword('pw-1234567890') });
  D.kvSet('settings', { notifyPrefs: { events: [], quietFrom: '', quietTo: '' }, security: { mfaRequired: 'none' } });
  D.putRecord('rooms', { id: 'general', name: 'General', kind: 'room', members: ['u1', 'u2', 'u3'] }, 'u1');
  D.db.close();
  const srv = spawn('node', ['index.js'], { cwd: require('node:path').resolve(__dirname, '..') + '/server', env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), ALLOW_UNENCRYPTED: '1', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (c) => (log += c)); srv.stderr.on('data', (c) => (log += c));
  for (let i = 0; i < 50 && !/\[boot\] /.test(log); i++) await sleep(100);
  try {
    const a = await login('jordan@x.com'), r = await login('sam@x.com'), adm = await login('cc@x.com');
    const msg = { id: 1, room: 'general', who: 'u1', at: '2026-09-28T10:00', text: 'Morning all', read: ['u1'], emailed: [] };
    const sync = (cookie, ops) => req('POST', '/sync', { cookie, body: { base: 0, ops, kv: {} } });
    t('Jordan posts', (await sync(a, [{ col: 'messages', id: '1', data: msg }])).status === 200);
    t('Sam marks it read (only read changes)', (await sync(r, [{ col: 'messages', id: '1', data: { ...msg, read: ['u1', 'u2'] } }])).status === 200);
    const e1 = await sync(r, [{ col: 'messages', id: '1', data: { ...msg, read: ['u1', 'u2'], text: 'Sam rewrote this' } }]);
    t('Sam cannot edit Jordan\' text (403)', e1.status === 403 && /Only the sender/.test(e1.body.error));
    const e2 = await sync(r, [{ col: 'messages', id: '1', data: { ...msg, read: ['u1', 'u2'], text: '', recalled: true } }]);
    t('Sam cannot recall Jordan\' message (403)', e2.status === 403);
    const e3 = await sync(r, [{ col: 'messages', id: '1', del: true }]);
    t('Sam cannot delete Jordan\' message (403)', e3.status === 403 && /sender or an admin/.test(e3.body.error));
    const ok1 = await sync(a, [{ col: 'messages', id: '1', data: { ...msg, read: ['u1', 'u2'], text: 'Morning all (fixed)', edited: '2026-09-28T10:05' } }]);
    t('Jordan edits his own message', ok1.status === 200 && (await req('GET', '/sync?since=0', { cookie: r })).body.records.find((x) => x.col === 'messages').data.text === 'Morning all (fixed)');
    t('Jordan recalls his own message', (await sync(a, [{ col: 'messages', id: '1', data: { ...msg, read: ['u1', 'u2'], text: '', recalled: true, edited: '2026-09-28T10:05' } }])).status === 200);
    t('an admin deletes it', (await sync(adm, [{ col: 'messages', id: '1', del: true }])).status === 200);
    const gone = (await req('GET', '/sync?since=0', { cookie: r })).body.records.find((x) => x.col === 'messages');
    t('message is gone for everyone', !gone || gone.data === null);
    t('Sam posts and deletes her own', (await sync(r, [{ col: 'messages', id: '2', data: { ...msg, id: 2, who: 'u2', text: 'oops' } }])).status === 200 && (await sync(r, [{ col: 'messages', id: '2', del: true }])).status === 200);
    const rd = await sync(r, [{ col: 'rooms', id: 'general', del: true }]);
    t('a manager cannot delete a room (403)', rd.status === 403 && /admin can delete a room/.test(rd.body.error));
    t('a manager can still create a room and delete their own DM', (await sync(r, [{ col: 'rooms', id: 'r_x', data: { id: 'r_x', name: 'Scratch', kind: 'room', members: ['u1', 'u2'] } }, { col: 'rooms', id: 'dm_u2_u1', data: { id: 'dm_u2_u1', name: '', kind: 'dm', members: ['u2', 'u1'] } }])).status === 200 && (await sync(r, [{ col: 'rooms', id: 'dm_u2_u1', del: true }])).status === 200);
    t('an admin deletes a room', (await sync(adm, [{ col: 'rooms', id: 'r_x', del: true }])).status === 200 && !(await req('GET', '/sync?since=0', { cookie: r })).body.records.some((x) => x.col === 'rooms' && x.id === 'r_x' && x.data));
    t('a rejected edit changes nothing on the server', !(await req('GET', '/sync?since=0', { cookie: a })).body.records.some((x) => x.col === 'messages' && x.data && /Sam rewrote/.test(x.data.text)));
  } finally { srv.kill('SIGTERM'); }
  if (process.exitCode) console.log(log.slice(-1200));
})().catch((e) => { console.error(e); process.exit(1); });
