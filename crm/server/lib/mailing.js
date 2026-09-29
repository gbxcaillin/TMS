'use strict';
// Mailing list + bulk email. Subscribers are a synced collection; website signups arrive via
// POST /hooks/subscribe and land here immediately (or as "pending" until they confirm, when
// MAILING_DOUBLE_OPTIN=1). Bulk sends go through mail.js, one message per recipient with a per-recipient
// unsubscribe link and one-click List-Unsubscribe headers (Spam Act 2003 requires a working
// unsubscribe; Gmail/Yahoo/Outlook require the headers), rate-limited to stay under send limits.
//
// Statuses: pending (awaiting confirmation) · subscribed · unsubscribed · bounced · complained.
// Only "subscribed" ever receives campaign mail.
const crypto = require('node:crypto');
const D = require('./db');
const mail = require('./mail');

const normEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const newToken = () => crypto.randomBytes(16).toString('hex');
const find = (email) => D.listCol('subscribers').find((s) => s.email === normEmail(email));
const byToken = (t) => (t ? D.listCol('subscribers').find((s) => s.token === t) : null);
// Website signups are single-click by default. Set MAILING_DOUBLE_OPTIN=1 to require an emailed
// confirmation first (only takes effect when we can actually send the confirmation email).
const doubleOptIn = () => process.env.MAILING_DOUBLE_OPTIN === '1' && mail.enabled();
const brand = 'Acme Advisory';

async function sendConfirm(s) {
  const url = `${mail.BASE}/api/v1/subscribe/confirm/${s.token}`;
  const first = (s.name || '').split(' ')[0];
  return mail.send({ to: s.email, subject: `Please confirm your subscription to ${brand}`, title: 'One more step', html: `<p>Hi ${mail.esc(first || 'there')},</p><p>Thanks for subscribing to insights from ${brand}. Please confirm it was you by clicking the button below. If you did not sign up, you can ignore this email and you will not hear from us.</p>`, cta: { label: 'Confirm my subscription', url }, footer: `${brand} · You are receiving this one-off email because this address was entered at example.com.`, kind: 'campaign' });
}

// Add a subscriber, or re-subscribe/enrich an existing one. Idempotent on email.
// { confirm: true } (website signups) applies double opt-in when it is switched on: new or
// previously unsubscribed addresses become "pending" and get a confirmation email. Otherwise,
// and for staff adding someone in the CRM, the address is subscribed immediately.
async function add(input, by = 'system', { confirm = false } = {}) {
  const email = normEmail(input.email);
  if (!validEmail(email)) return { error: 'A valid email is required' };
  const now = D.nowIso();
  const tags = Array.isArray(input.tags) ? input.tags.map((t) => String(t).slice(0, 40)).filter(Boolean).slice(0, 20) : [];
  const needsConfirm = confirm && doubleOptIn();
  let s = find(email);
  if (s) {
    const was = s.status;
    if (was === 'subscribed') { // already in: just enrich, never re-mail
      if (input.name && !s.name) s.name = String(input.name).slice(0, 120);
      if (tags.length) s.tags = [...new Set([...(s.tags || []), ...tags])].slice(0, 20);
      D.putRecord('subscribers', s, by);
      return { subscriber: s, created: false, resubscribed: false, pending: false };
    }
    if (!s.token) s.token = newToken();
    if (input.name && !s.name) s.name = String(input.name).slice(0, 120);
    if (input.source && !s.source) s.source = String(input.source).slice(0, 60);
    if (tags.length) s.tags = [...new Set([...(s.tags || []), ...tags])].slice(0, 20);
    s.status = needsConfirm ? 'pending' : 'subscribed';
    if (!needsConfirm) { s.confirmedAt = now; delete s.unsubAt; }
    D.putRecord('subscribers', s, by);
    if (needsConfirm) await sendConfirm(s);
    return { subscriber: s, created: false, resubscribed: !needsConfirm && was !== 'subscribed', pending: needsConfirm };
  }
  s = { id: D.nextId('subscribers'), email, name: String(input.name || '').slice(0, 120), source: String(input.source || 'website').slice(0, 60), tags, status: needsConfirm ? 'pending' : 'subscribed', token: newToken(), at: now };
  if (!needsConfirm) s.confirmedAt = now;
  D.putRecord('subscribers', s, by);
  if (needsConfirm) await sendConfirm(s);
  return { subscriber: s, created: true, pending: needsConfirm };
}

// Confirm a pending subscription from the emailed link. Idempotent; returns null for a bad token.
function confirm(token) {
  const s = byToken(token);
  if (!s) return null;
  if (s.status !== 'subscribed') { s.status = 'subscribed'; s.confirmedAt = D.nowIso(); delete s.unsubAt; D.putRecord('subscribers', s, 'system'); }
  return s;
}

// Mark a subscriber unsubscribed by their unsubscribe token (from an email link). Idempotent.
function unsubscribe(token) {
  const s = byToken(token);
  if (!s) return null;
  if (s.status !== 'unsubscribed') { s.status = 'unsubscribed'; s.unsubAt = D.nowIso(); D.putRecord('subscribers', s, 'system'); }
  return s;
}

// Suppress an address after a hard bounce or spam complaint (provider webhook). Complaints
// always win over bounces. Unknown addresses are ignored (they were not on the list).
function suppress(email, reason, detail = '') {
  const s = find(email);
  if (!s) return null;
  const status = reason === 'complaint' ? 'complained' : 'bounced';
  if (s.status === 'complained' || s.status === status) return s;
  s.status = status; s.suppressedAt = D.nowIso(); s.suppressReason = String(detail || reason).slice(0, 120);
  D.putRecord('subscribers', s, 'system');
  return s;
}

// Send a bulk email to subscribed recipients. Audience is one of: an explicit `emails` batch
// (per-person selection), a `tag`, or everyone subscribed. {{name}} is personalised and a
// per-recipient unsubscribe link is added. `prepared` = the html is a complete newsletter and
// is sent as-is (unsubscribe appended); otherwise it is wrapped in the branded app layout.
/* ---------- queued bulk sends ----------
 * enqueueBulk() resolves the audience and writes one row per recipient, then processQueue() works
 * through them in the background at a steady pace (Resend allows about 2 requests a second). State
 * is in SQLite, so a restart mid-send picks up where it left off; nobody gets the issue twice.
 * A small synced `sends` record carries the counters the app shows. */
const PACE_MS = 500;          // gap between sends (2/sec keeps under Resend's default rate limit)
const BATCH = 40;             // rows claimed per loop; counters are pushed to the app after each batch
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function sendRecord(id) { return D.getRecord('sends', id); }
function saveSend(rec) { D.putRecord('sends', rec, 'system'); return rec; }
function refreshCounts(rec) { const c = D.sendq.counts(rec.id); rec.sent = c.sent || 0; rec.failed = c.failed || 0; rec.pending = c.pending || 0; rec.cancelled = c.cancelled || 0; return rec; }

function resolveAudience({ tag, emails }) {
  let list = D.listCol('subscribers').filter((s) => s.status === 'subscribed');
  if (Array.isArray(emails) && emails.length) { const want = new Set(emails.map(normEmail)); list = list.filter((s) => want.has(normEmail(s.email))); }
  else if (tag) list = list.filter((s) => (s.tags || []).includes(tag));
  return list;
}

function enqueueBulk({ subject, html, tag, emails, prepared }, by = 'system') {
  if (!mail.enabled()) return { error: 'Email is not configured on the server (set RESEND_API_KEY)' };
  subject = String(subject || '').trim().slice(0, 200); html = String(html || '');
  if (!subject || !html) return { error: 'Subject and message are required' };
  const list = resolveAudience({ tag, emails });
  if (!list.length) return { error: 'No subscribers match that audience' };
  const sender = by && by !== 'system' ? (D.users.get(by) || {}) : {};
  const audience = Array.isArray(emails) && emails.length ? `${list.length} selected` : tag ? `Tag: ${tag}` : 'All subscribed';
  const rec = D.transaction(() => {
    const id = D.nextId('sends');
    D.sendq.putJob(id, subject, html, !!prepared, sender.email || '', by);
    for (const s of list) {
      if (!s.token) { s.token = crypto.randomBytes(16).toString('hex'); D.putRecord('subscribers', s, 'system'); }
      D.sendq.addItem.run(id, s.email, s.name || '', s.token, 'pending', '', null);
    }
    return saveSend({ id, subject, audience, by, at: D.nowIso(), status: 'queued', total: list.length, sent: 0, failed: 0, pending: list.length, cancelled: 0, startedAt: '', finishedAt: '' });
  })();
  setTimeout(() => processQueue().catch((e) => console.error('[sendq]', e.message)), 50);
  return { job: rec.id, total: rec.total };
}

async function sendOne(job, item) {
  const unsub = `${mail.BASE}/api/v1/unsubscribe/${item.token}`;
  const personalised = job.html.replace(/\{\{\s*name\s*\}\}/g, mail.esc((item.name || 'there').split(' ')[0]));
  const opts = { to: item.email, subject: job.subject, kind: 'campaign', unsubscribe: unsub, replyTo: job.reply_to || undefined };
  if (job.prepared) {
    const withFooter = /\{\{\s*unsubscribe\s*\}\}/.test(personalised) ? personalised.replace(/\{\{\s*unsubscribe\s*\}\}/g, unsub) : personalised + `<p style="font-size:11px;color:#8A919C;text-align:center;margin:24px 0 0"><a href="${unsub}" style="color:#8A919C">Unsubscribe</a></p>`;
    return mail.send({ ...opts, html: withFooter, raw: true });
  }
  const footer = `You are receiving this because you subscribed on example.com. <a href="${unsub}" style="color:#8A919C">Unsubscribe</a>`;
  return mail.send({ ...opts, title: '', html: personalised, footer });
}

let inflight = null;
// Works every queued/sending job to completion, oldest first. Safe to call often: only one loop runs at a
// time, and a call made while it is running just waits for that loop.
function processQueue() {
  if (!mail.enabled()) return Promise.resolve(0);
  if (!inflight) inflight = runQueue().finally(() => { inflight = null; });
  return inflight;
}
async function runQueue() {
  let done = 0;
  try {
    for (;;) {
      const rec = D.listCol('sends').filter((r) => r.status === 'queued' || r.status === 'sending').sort((a, b) => a.id - b.id)[0];
      if (!rec) break;
      const job = D.sendq.job(rec.id);
      if (!job) { rec.status = 'failed'; rec.error = 'Send body missing'; rec.finishedAt = D.nowIso(); saveSend(rec); continue; }
      if (rec.status !== 'sending') { rec.status = 'sending'; rec.startedAt = rec.startedAt || D.nowIso(); saveSend(rec); }
      const batch = D.sendq.pending(rec.id, BATCH);
      if (!batch.length) { refreshCounts(rec); rec.status = 'done'; rec.finishedAt = D.nowIso(); saveSend(rec); finished(rec); continue; }
      for (const item of batch) {
        const cur = sendRecord(rec.id); if (!cur || cur.status === 'cancelled') break;    // cancelled from the app mid-batch
        const t0 = Date.now();
        let ok = false, detail = '';
        try { ok = await sendOne(job, item); if (!ok) detail = lastMailError(item.email); } catch (e) { detail = String(e.message || e).slice(0, 200); }
        D.sendq.setItem.run(ok ? 'sent' : 'failed', detail, D.nowIso(), rec.id, item.email);
        done++;
        const wait = PACE_MS - (Date.now() - t0); if (wait > 0) await sleep(wait);
      }
      const cur = sendRecord(rec.id);
      if (cur && cur.status === 'cancelled') { D.sendq.cancelPending(rec.id); refreshCounts(cur); cur.finishedAt = D.nowIso(); saveSend(cur); continue; }
      saveSend(refreshCounts(cur || rec));
    }
  } catch (e) { console.error('[sendq]', e.message); }
  return done;
}
function lastMailError(to) { const r = D.log.mailRecent.all(5).find((m) => m.to_addr === to && m.status === 'failed'); return r ? String(r.detail || '').slice(0, 200) : 'send failed'; }
function finished(rec) {
  const by = rec.by && rec.by !== 'system' ? D.users.get(rec.by) : null;
  const text = `Newsletter sent: "${rec.subject}"`; const p = `${rec.sent} of ${rec.total} delivered to Resend${rec.failed ? ` · ${rec.failed} failed` : ''}${rec.cancelled ? ` · ${rec.cancelled} cancelled` : ''}`;
  if (by) D.putRecord('notifs', { id: Date.now(), to: by.id, text, p, at: D.nowIso().slice(11, 16), read: false, go: '#/mailing', day: D.today() }, 'system');
  console.log('[sendq]', text, p);
}
function cancelSend(id) {
  const rec = sendRecord(id); if (!rec) return { error: 'No such send' };
  if (!['queued', 'sending'].includes(rec.status)) return { error: 'That send has already finished' };
  D.sendq.cancelPending(id); refreshCounts(rec); rec.status = 'cancelled'; rec.finishedAt = D.nowIso(); saveSend(rec);
  return { ok: true, cancelled: rec.cancelled };
}
function retrySend(id) {
  const rec = sendRecord(id); if (!rec) return { error: 'No such send' };
  if (['queued', 'sending'].includes(rec.status)) return { error: 'That send is still running' };
  const n = D.sendq.resetFailed(id); if (!n) return { error: 'Nothing failed on that send' };
  refreshCounts(rec); rec.status = 'queued'; rec.finishedAt = ''; saveSend(rec);
  setTimeout(() => processQueue().catch((e) => console.error('[sendq]', e.message)), 50);
  return { ok: true, retrying: n };
}
function sendReport(id) {
  const rec = sendRecord(id); if (!rec) return null;
  return { ...refreshCounts(rec), failures: D.sendq.items(id, 'failed').slice(0, 500), recipients: D.sendq.items(id).length };
}
function deleteSend(id) { const rec = sendRecord(id); if (!rec) return { error: 'No such send' }; if (['queued', 'sending'].includes(rec.status)) return { error: 'Cancel it first' }; D.sendq.drop(id); D.delRecord('sends', id, 'system'); return { ok: true }; }

module.exports = { add, confirm, unsubscribe, suppress, enqueueBulk, processQueue, cancelSend, retrySend, sendReport, deleteSend, find, normEmail, doubleOptIn };
