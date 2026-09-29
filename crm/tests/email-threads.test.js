// Email conversations on the card: threads.logMail and the mailbox sync with a stubbed mailbox.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'threads-')); process.env.ALLOW_UNENCRYPTED = '1';
const ROOT = require('node:path').resolve(__dirname, '..') + '/server/lib/';
const t = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) process.exitCode = 1; };
// Stub the mailbox before anything loads it.
const mb = require(ROOT + 'mailbox');
let inbox = [], sent = [], full = {};
mb.accounts = () => [{ user: 'u1', email: 'jordan@brightday.com.au' }];
mb.enabled = () => true;
mb.recentIn = async (uid, email, folder) => (folder === 'inbox' ? inbox : sent);
mb.message = async (uid, email, id) => full[id] || null;
const push = require(ROOT + 'push'); const pushed = []; push.sendToUser = async (uid, p) => { pushed.push({ uid, ...p }); return 1; };
const D = require(ROOT + 'db'); const threads = require(ROOT + 'threads'); const mailsync = require(ROOT + 'mailsync');
(async () => {
  D.users.insert({ id: 'u1', email: 'jordan@brightday.com.au', name: 'Jordan Lee', role: 'Manager', status: 'Active', color: '#000' });
  D.kvSet('settings', { notifyPrefs: { events: [], quietFrom: '', quietTo: '' } });
  D.kvSet('stages', [{ id: 'new' }, { id: 'won', closed: true }]);
  D.putRecord('deals', { id: 7, practice: 'Harbourline', contact: 'Sarah Whitfield', email: 'Sarah@Harbourline.com.au', stage: 'new', owner: 'u1', created: '2026-09-20' }, 'u1');
  D.putRecord('deals', { id: 8, practice: 'Old Harbourline', contact: 'Sarah Whitfield', email: 'sarah@harbourline.com.au', stage: 'won', owner: 'u1', created: '2026-01-01' }, 'u1');
  // 1. The address resolves to the open deal, not the closed older one.
  const tg = threads.targetFor('SARAH@harbourline.com.au');
  t('address resolves to the open deal (7) with owner and name', tg && tg.deal === 7 && tg.owner === 'u1' && tg.name === 'Sarah Whitfield');
  // 2. A CRM send logs an outbound message in a new thread.
  const th1 = threads.logMail({ ...tg, subject: 'Harbourline — next steps with BD', inbound: false, from: 'Jordan Lee', at: '2026-09-28T00:00:00', body: 'Hi Sarah, attached is the proposal.', uid: 'u1' });
  t('outbound send creates the thread: folder sent, 1 message, not unread', th1 && th1.folder === 'sent' && th1.msgs.length === 1 && th1.msgs[0].out && !th1.unread && th1.addr === 'sarah@harbourline.com.au');
  // 3. Sync: the Sent Items copy of that email (with a mail id) folds into the same message; Sarah's reply joins the thread.
  sent = [{ id: 'S1', conv: 'CONV1', subject: 'Harbourline — next steps with BD', from: 'jordan@brightday.com.au', fromName: 'Jordan', to: ['sarah@harbourline.com.au'], at: '2026-09-28T00:03:00Z', preview: 'Hi Sarah, attached is the proposal.', url: 'https://outlook/S1' }];
  inbox = [{ id: 'I1', conv: 'CONV1', subject: 'RE: Harbourline — next steps with BD', from: 'sarah@harbourline.com.au', fromName: 'Sarah Whitfield', to: ['jordan@brightday.com.au'], at: '2026-09-28T01:30:00Z', preview: 'Thanks Jordan, looks good, one question on fees.', url: 'https://outlook/I1' }];
  full.I1 = { text: 'Thanks Jordan, looks good, one question on fees.\n\nWhat is the retainer?' };
  const n = await mailsync.syncAccount('u1', 'jordan@brightday.com.au');
  const all = D.listCol('threads').filter((x) => x.deal === 7);
  const th = all[0];
  t('sync logged 2 messages into ONE thread (' + all.length + ' thread, ' + (th ? th.msgs.length : 0) + ' msgs)', n === 2 && all.length === 1 && th.msgs.length === 2);
  t('the Sent Items copy folded into the CRM-sent message and gained its Outlook link', th.msgs[0].out && th.msgs[0].mailId === 'S1' && /outlook\/S1/.test(th.msgs[0].url));
  t('the reply is inbound, full text, marks the thread unread and sets the Outlook conversation', !th.msgs[1].out && /retainer/.test(th.msgs[1].body) && th.unread && th.folder === 'inbox' && th.conv === 'CONV1' && th.msgs[1].from === 'Sarah Whitfield');
  t('timeline: the reply is logged, the Sent Items copy of the CRM send is not', D.listCol('activity').filter((a) => a.deal === 7 && a.type === 'email').map((a) => a.mailId).join() === 'I1' || D.listCol('activity').filter((a) => a.deal === 7 && a.mailId === 'I1').length === 1);
  t('the owner is alerted about the reply with a deep link to the deal', pushed.some((p) => p.uid === 'u1' && p.kind === 'reply' && /Sarah Whitfield replied/.test(p.title) && p.url === '#/deal/7'));
  // 4. Running the sync again changes nothing.
  const before = JSON.stringify(D.listCol('threads')); const n2 = await mailsync.syncAccount('u1', 'jordan@brightday.com.au');
  t('a second sync is a no-op', n2 === 0 && JSON.stringify(D.listCol('threads')) === before && pushed.length === 1);
  // 5. A later message in the same Outlook conversation but with a changed subject still lands in the thread.
  inbox = inbox.concat([{ id: 'I2', conv: 'CONV1', subject: 'Fwd: Harbourline — next steps with BD', from: 'sarah@harbourline.com.au', fromName: 'Sarah Whitfield', to: ['jordan@brightday.com.au'], at: '2026-09-28T02:00:00Z', preview: 'Forwarding to my partner.', url: '' }]);
  await mailsync.syncAccount('u1', 'jordan@brightday.com.au');
  t('same conversation, different subject prefix: still one thread with 3 messages', D.listCol('threads').filter((x) => x.deal === 7).length === 1 && D.getRecord('threads', th.id).msgs.length === 3);
  // 6. A different subject without a conversation id starts a new thread; unknown addresses are ignored.
  threads.logMail({ ...tg, subject: 'Invoice 1042', inbound: false, from: 'Jordan', at: '2026-09-28T12:00', body: 'Invoice attached', uid: 'u1' });
  t('a new subject starts a second thread', D.listCol('threads').filter((x) => x.deal === 7).length === 2);
  t('an address that matches nothing is ignored', threads.targetFor('nobody@brightday.com.au') === null);
  t('thread ids are stable numbers', threads.threadId(7, 'c:CONV1') === threads.threadId(7, 'c:CONV1') && Number.isInteger(threads.threadId(7, 'c:CONV1')));
})().catch((e) => { console.error(e); process.exit(1); });
