// Reproduces "only the most recent email shows": a deal whose thread holds just the latest reply while older mail
// sits only on the timeline (synced before the conversation view) or beyond the newest 25. The back-fill must fill it.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hist-')); process.env.ALLOW_UNENCRYPTED = '1';
const L = require('node:path').resolve(__dirname, '..') + '/server/lib/';
const t = (n, ok, x) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || x === undefined ? '' : ' :: ' + JSON.stringify(x).slice(0, 400))); if (!ok) process.exitCode = 1; };
const mb = require(L + 'mailbox'); let calls = 0;
mb.accounts = () => [{ user: 'u1', email: 'jordan@brightday.com.au' }]; mb.enabled = () => true;
mb.recentIn = async (uid, email, folder) => (folder === 'inbox' ? [{ id: 'M6', conv: 'C1', subject: 'RE: Harbourline proposal', from: 'sarah@harbourline.com.au', fromName: 'Sarah Whitfield', to: ['jordan@brightday.com.au'], at: '2026-09-20T01:00:00Z', preview: 'Signed, see attached.', url: 'u6' }] : []);
mb.message = async () => null;
const HIST = [
  { id: 'M1', conv: 'C1', subject: 'Harbourline proposal', from: 'jordan@brightday.com.au', to: ['sarah@harbourline.com.au'], cc: [], at: '2026-09-01T00:00:00Z', text: 'Hi Sarah, proposal attached.', url: 'u1' },
  { id: 'M2', conv: 'C1', subject: 'RE: Harbourline proposal', from: 'sarah@harbourline.com.au', fromName: 'Sarah Whitfield', to: ['jordan@brightday.com.au'], cc: [], at: '2026-09-02T00:00:00Z', text: 'Thanks, a question on fees.', url: 'u2' },
  { id: 'M3', conv: 'C1', subject: 'RE: Harbourline proposal', from: 'jordan@brightday.com.au', to: ['sarah@harbourline.com.au'], cc: [], at: '2026-09-03T00:00:00Z', text: 'The retainer is monthly.', url: 'u3' },
  { id: 'M4', conv: 'C2', subject: 'Intro call notes', from: 'sarah@harbourline.com.au', fromName: 'Sarah Whitfield', to: ['jordan@brightday.com.au'], cc: [], at: '2026-08-20T00:00:00Z', text: 'Great to meet you.', url: 'u4' },
  { id: 'M5', conv: 'C1', subject: 'RE: Harbourline proposal', from: 'bob@harbourline.com.au', to: ['jordan@brightday.com.au'], cc: ['sarah@harbourline.com.au'], at: '2026-09-04T00:00:00Z', text: 'Bob here, cc Sarah.', url: 'u5' },
  { id: 'M6', conv: 'C1', subject: 'RE: Harbourline proposal', from: 'sarah@harbourline.com.au', fromName: 'Sarah Whitfield', to: ['jordan@brightday.com.au'], cc: [], at: '2026-09-20T01:00:00Z', text: 'Signed, see attached.', url: 'u6' },
];
mb.withAddress = async (uid, email, addr) => { calls++; return HIST.filter((m) => [m.from, ...m.to, ...m.cc].includes(addr)).reverse(); };
const push = require(L + 'push'); const pushed = []; push.sendToUser = async (u, p) => { pushed.push(p); return 1; };
const D = require(L + 'db'); const threads = require(L + 'threads'); const ms = require(L + 'mailsync');
(async () => {
  D.users.insert({ id: 'u1', email: 'jordan@brightday.com.au', name: 'Jordan', role: 'Manager', status: 'Active', color: '#000' });
  D.kvSet('settings', { notifyPrefs: { events: [] } }); D.kvSet('stages', [{ id: 'new' }]);
  D.putRecord('deals', { id: 7, practice: 'Harbourline', contact: 'Sarah Whitfield', email: 'sarah@harbourline.com.au', stage: 'new', owner: 'u1', created: '2026-08-01' }, 'u1');
  // Before: M2 and M3 reached only the timeline (old sync); the thread holds just the latest reply M6, read.
  for (const id of ['M2', 'M3', 'M6']) D.putRecord('activity', { id: Number(id.slice(1)) * 1000, deal: 7, type: 'email', text: 'old', at: '2026-09-0' + id.slice(1), mailId: id }, 'system');
  const th = threads.logMail({ deal: 7, name: 'Sarah Whitfield', addr: 'sarah@harbourline.com.au', subject: 'RE: Harbourline proposal', conv: 'C1', inbound: true, from: 'Sarah Whitfield', at: '2026-09-20T11:00', body: 'Signed, see attached.', mailId: 'M6', url: 'u6' });
  th.unread = false; D.putRecord('threads', th, 'system');
  t('reproduced: the thread shows only the most recent email', D.listCol('threads').filter((x) => x.deal === 7).reduce((a, x) => a + x.msgs.length, 0) === 1);
  await ms.syncAll();
  const all = D.listCol('threads').filter((x) => x.deal === 7); const c1 = all.find((x) => x.conv === 'C1'); const c2 = all.find((x) => x.conv === 'C2');
  t('after the sync the proposal thread has the whole exchange, oldest first (M1, M2, M3, M6)', c1 && c1.msgs.map((m) => m.mailId).join() === 'M1,M2,M3,M6', c1 && c1.msgs.map((m) => m.mailId));
  t('directions are right: M1 and M3 ours, M2 and M6 Sarah\'s', c1.msgs.map((m) => (m.out ? 'out' : 'in')).join() === 'out,in,out,in');
  t('the earlier conversation (intro call) is its own thread', c2 && c2.msgs.length === 1 && c2.msgs[0].mailId === 'M4');
  t('a colleague\'s email with Sarah only on cc is not in the conversation', !all.some((x) => x.msgs.some((m) => m.mailId === 'M5')));
  t('back-filled history does not mark threads unread or send alerts', !c1.unread && !c2.unread && pushed.length === 0);
  const acts = D.listCol('activity').filter((a) => a.deal === 7 && a.mailId);
  t('timeline gains the missing emails once each (M1, M4); M2, M3, M6 are not duplicated', ['M1', 'M2', 'M3', 'M4', 'M6'].every((id) => acts.filter((a) => a.mailId === id).length === 1), acts.map((a) => a.mailId));
  const before = calls; await ms.syncAll();
  t('the next sync does not fetch the history again', calls === before);
  const n = await ms.backfill(7);
  t('Load full history re-checks and finds nothing new', n === 0 && calls === before + 1 && D.listCol('threads').filter((x) => x.deal === 7).reduce((a, x) => a + x.msgs.length, 0) === 5);
})().catch((e) => { console.error(e); process.exit(1); });
