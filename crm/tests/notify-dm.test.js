// Unit test: the DM / mention notification branch in server/lib/notify.js, with push stubbed.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'live-unit-'));
process.env.ALLOW_UNENCRYPTED = '1';
const ROOT = require('node:path').resolve(__dirname, '..') + '/server/lib/';
const D = require(ROOT + 'db');
const push = require(ROOT + 'push');
const sent = [];
push.sendToUser = async (uid, payload) => { sent.push({ uid, ...payload }); return 1; };
const notify = require(ROOT + 'notify');
const t = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) process.exitCode = 1; };
(async () => {
  D.users.insert({ id: 'u1', email: 'a@x.com', name: 'Jordan Lee', role: 'Manager', status: 'Active', color: '#000' });
  D.users.insert({ id: 'u2', email: 'b@x.com', name: 'Sam Rivera', role: 'Manager', status: 'Active', color: '#000' });
  D.users.insert({ id: 'u3', email: 'c@x.com', name: 'Chris Taylor', role: 'Manager', status: 'Active', color: '#000' });
  D.kvSet('settings', { notifyPrefs: { events: [], quietFrom: '', quietTo: '' } });
  D.putRecord('rooms', { id: 'dm_u1_u2', name: '', kind: 'dm', members: ['u1', 'u2'] }, 'u1');
  D.putRecord('rooms', { id: 'general', name: 'General', kind: 'room', members: ['u1', 'u2', 'u3'] }, 'u1');
  const notifs = () => D.listCol('notifs');

  await notify.onRecordChange('u1', 'messages', null, { id: 1, room: 'dm_u1_u2', who: 'u1', at: '2026-09-28T10:00', text: 'Can you check the Harbourline scope?', read: ['u1'], emailed: [] });
  t('DM pushes the other person once, kind dm, deep link to the room', sent.length === 1 && sent[0].uid === 'u2' && sent[0].kind === 'dm' && sent[0].url === '#/chat/dm_u1_u2' && sent[0].title === 'Jordan sent you a message' && /Harbourline/.test(sent[0].body));
  t('DM writes a bell record addressed to the recipient', notifs().some((n) => n.to.join() === 'u2' && n.go === '#/chat/dm_u1_u2'));

  sent.length = 0;
  await notify.onRecordChange('u1', 'messages', null, { id: 2, room: 'dm_u1_u2', who: 'u1', at: '2026-09-28T10:01', text: '@Sam ping', read: ['u1'], emailed: [] });
  t('a mention inside a DM alerts once (mention), not twice', sent.length === 1 && sent[0].kind === 'mention' && sent[0].url === '#/chat/dm_u1_u2');

  sent.length = 0;
  await notify.onRecordChange('u1', 'messages', null, { id: 3, room: 'general', who: 'u1', at: '2026-09-28T10:02', text: 'Morning all', read: ['u1'], emailed: [] });
  t('a plain room message sends no push', sent.length === 0);

  sent.length = 0;
  await notify.onRecordChange('u1', 'messages', null, { id: 4, room: 'general', who: 'u1', at: '2026-09-28T10:03', text: '@Chris see above', read: ['u1'], emailed: [] });
  t('a room mention still alerts the mentioned person only', sent.length === 1 && sent[0].uid === 'u3' && sent[0].kind === 'mention');

  sent.length = 0;
  D.kvSet('settings', { notifyPrefs: { events: [{ id: 'dm', app: true, email: false, push: false }], quietFrom: '', quietTo: '' } });
  const before = notifs().length;
  await notify.onRecordChange('u1', 'messages', null, { id: 5, room: 'dm_u1_u2', who: 'u1', at: '2026-09-28T10:04', text: 'quiet one', read: ['u1'], emailed: [] });
  t('DM row with push off: bell only, no push', sent.length === 0 && notifs().length === before + 1);

  sent.length = 0;
  await notify.onRecordChange('u1', 'messages', { id: 5 }, { id: 5, room: 'dm_u1_u2', who: 'u1', at: '2026-09-28T10:04', text: 'quiet one', read: ['u1', 'u2'], emailed: [] });
  t('marking a DM read (an update, not a new message) sends nothing', sent.length === 0);

  sent.length = 0;
  await notify.onRecordChange('u2', 'messages', null, { id: 6, room: 'dm_u1_u2', who: 'u2', at: '2026-09-28T10:05', text: '', file: { name: 'scope.docx', fileId: 9 }, read: ['u2'], emailed: [] });
  D.kvSet('settings', { notifyPrefs: { events: [], quietFrom: '', quietTo: '' } });
  await notify.onRecordChange('u2', 'messages', null, { id: 7, room: 'dm_u1_u2', who: 'u2', at: '2026-09-28T10:06', text: '', file: { name: 'scope.docx', fileId: 9 }, read: ['u2'], emailed: [] });
  t('a file-only DM reads "Sent a file" and goes the other way', sent.some((s) => s.uid === 'u1' && s.body === 'Sent a file'));
})().catch((e) => { console.error(e); process.exit(1); });
