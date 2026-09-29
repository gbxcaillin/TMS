// Push payload links are anchored to the site root so any service worker version opens the app, not sw.js.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'push-url-'));
process.env.ALLOW_UNENCRYPTED = '1';
const webpush = require(require('node:path').resolve(__dirname, '..') + '/server/node_modules/web-push');
const sent = [];
webpush.sendNotification = async (sub, payload) => { sent.push(JSON.parse(payload)); return {}; };
const push = require(require('node:path').resolve(__dirname, '..') + '/server/lib/push');
const D = require(require('node:path').resolve(__dirname, '..') + '/server/lib/db');
const t = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) process.exitCode = 1; };
(async () => {
  D.users.insert({ id: 'u2', email: 'sam@x.com', name: 'Sam Rivera', role: 'Manager', status: 'Active', color: '#000' });
  push.subscribe('u2', 'Test phone', { endpoint: 'https://push.example/abc', keys: { p256dh: 'x', auth: 'y' } });
  await push.sendToUser('u2', { title: 'Jordan sent you a message', body: 'hi', url: '#/chat/dm_u1_u2', kind: 'dm', id: 1 });
  t('hash link becomes /#/chat/... in the payload', sent[0].url === '/#/chat/dm_u1_u2');
  t('resolved against the worker URL it opens the app root, not sw.js', new URL(sent[0].url, 'https://portal.brightday.com.au/sw.js').href === 'https://portal.brightday.com.au/#/chat/dm_u1_u2');
  await push.sendToUser('u2', { title: 'x', url: '/#/tasks', kind: 'task', id: 2 });
  t('already-anchored links are left alone', sent[1].url === '/#/tasks');
  await push.sendToUser('u2', { title: 'x', kind: 'system', id: 3 });
  t('no url survives untouched', sent[2].url === undefined);
  // The new service worker's own rule, for old payloads still in flight.
  const swRule = (url) => new URL(String(url || '#/dashboard').replace(/^#/, './index.html#'), 'https://portal.brightday.com.au/sw.js').href;
  t('service worker maps a bare hash to index.html', swRule('#/chat/dm_u1_u2') === 'https://portal.brightday.com.au/index.html#/chat/dm_u1_u2' && swRule('/#/tasks') === 'https://portal.brightday.com.au/#/tasks');
})().catch((e) => { console.error(e); process.exit(1); });
