'use strict';
// What an admin should hear about without a user having to report it:
//  - clientError(): an error card or uncaught error in someone's browser. Logged and audited every time; admins get
//    one alert per distinct message per 6 hours.
//  - jobFailed(name, err) / jobOk(name): a background job that fails three runs in a row alerts the admins, again
//    once a day while it keeps failing, and once more when it recovers.
const D = require('./db');
const { notify } = require('./notify');

const admins = () => D.users.all().filter((u) => u.role === 'Admin' && u.status === 'Active').map((u) => u.id);
const LABEL = { market: 'Price refresh (Yahoo Finance)', refdata: 'Morningstar reference data import', mailsync: 'Mailbox sync', calendar: 'Calendar sync', bookings: 'Bookings sync', backup: 'Nightly backup', digest: 'Morning digest', chat: 'Unread chat digest', nurture: 'Nurture sequences', score: 'Lead scoring', sendq: 'Newsletter sending', notereview: 'Research note reviews' };
const label = (n) => LABEL[n] || n;
const blank = () => ({ n: 0, since: '', last: '', msg: '', alertedAt: '' });
const state = (name) => D.cache.get('jobfail:' + name) || blank();
const when = (iso) => D.localIso(new Date(iso)).slice(0, 16).replace('T', ' ');

async function jobFailed(name, e) {
  const s = state(name); const msg = String((e && e.message) || e || 'failed').replace(/\s+/g, ' ').slice(0, 300);
  s.n++; s.last = new Date().toISOString(); s.msg = msg; if (!s.since) s.since = s.last;
  console.error(`[job ${name}]`, msg);
  if (s.n >= 3 && (!s.alertedAt || Date.now() - new Date(s.alertedAt).getTime() > 24 * 3600e3)) {
    s.alertedAt = s.last;
    await notify('system', admins(), { title: `${label(name)} is failing`, body: `${s.n} failed runs in a row since ${when(s.since)}: ${msg}`.slice(0, 220), url: '#/integrations', kind: 'system', id: 'job-' + name }).catch(() => {});
  }
  D.cache.set('jobfail:' + name, s);
}
async function jobOk(name) {
  const s = state(name); if (!s.n) return;
  D.cache.set('jobfail:' + name, { ...blank(), recoveredAt: new Date().toISOString() });
  if (s.alertedAt) await notify('system', admins(), { title: `${label(name)} is working again`, body: `It recovered after ${s.n} failed runs.`, url: '#/integrations', kind: 'system', id: 'job-' + name }).catch(() => {});
}
function jobHealth(name) { const s = state(name); return { label: label(name), failures: s.n, failingSince: s.since, lastError: s.msg, lastFailure: s.last }; }

const alerted = new Map(); const perUser = new Map();
// Returns false when the report was dropped (more than 20 an hour from one person).
async function clientError(u, e) {
  const who = u ? u.id : 'anon'; const hour = Math.floor(Date.now() / 3600e3); const k = who + ':' + hour;
  const c = (perUser.get(k) || 0) + 1; perUser.set(k, c); if (c > 20) return false;
  if (perUser.size > 500) perUser.clear();
  const msg = String(e.message || 'Unknown error').replace(/\s+/g, ' ').slice(0, 300); const where = String(e.route || '').slice(0, 80);
  const stack = String(e.stack || '').split('\n').slice(0, 4).map((l) => l.trim()).join(' | ').slice(0, 600);
  console.error('[client error]', u ? u.email : 'signed out', where, msg, stack);
  D.audit(who, '', 'client.error', where, (msg + (stack ? ' @ ' + stack : '')).slice(0, 500));
  const key = msg.replace(/\d+/g, '#').slice(0, 120); const last = alerted.get(key) || 0;
  if (Date.now() - last < 6 * 3600e3) return true;
  alerted.set(key, Date.now());
  await notify('system', admins(), { title: `App error for ${u ? u.name : 'a user'}: ${msg}`.slice(0, 140), body: `On ${where || 'a page'}${e.version ? ' · version ' + String(e.version).slice(0, 20) : ''}. Details are in the audit log.`, url: '#/integrations', kind: 'system', id: 'err-' + key.slice(0, 40) }).catch(() => {});
  return true;
}
module.exports = { jobFailed, jobOk, jobHealth, clientError, LABEL };
