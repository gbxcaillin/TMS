'use strict';
// Email on the card: every 15 minutes, each connected mailbox's recent inbox and sent items are matched to
// deals and clients by the other party's address. Each matching message becomes a timestamped entry on the
// deal's timeline (subject, preview, Open in Outlook) and a message in the deal's email conversation
// (lib/threads.js), and a reply from the contact alerts the deal's owner. Messages already logged, and emails
// the CRM itself sent moments earlier, are not duplicated.
const D = require('./db');
const mailbox = require('./mailbox');
const threads = require('./threads');
const { notify } = require('./notify');

const lower = (s) => String(s || '').toLowerCase().trim();
function targets() {
  const byEmail = new Map();
  const closed = new Set((D.kvGet('stages') || []).filter((s) => s.closed).map((s) => s.id));
  const deals = D.listCol('deals').sort((a, b) => (closed.has(a.stage) - closed.has(b.stage)) || String(b.created || '').localeCompare(String(a.created || '')));
  for (const d of deals) if (d.email && !byEmail.has(lower(d.email))) byEmail.set(lower(d.email), { deal: d.id, client: d.client || 0, name: d.contact || d.practice, owner: d.owner || '', addr: lower(d.email) });
  for (const c of D.listCol('clients')) if (c.email && !byEmail.has(lower(c.email))) byEmail.set(lower(c.email), { deal: (c.deals || [])[0] || 0, client: c.id, name: c.contact || c.name, owner: c.owner || '', addr: lower(c.email) });
  return byEmail;
}
async function syncAccount(uid, email) {
  const map = targets(); if (!map.size) return 0;
  const acts = D.listCol('activity'); const seen = new Set(acts.filter((a) => a.mailId).map((a) => a.mailId));
  let n = 0;
  for (const folder of ['inbox', 'sentitems']) {
    let msgs; try { msgs = await mailbox.recentIn(uid, email, folder, 25); } catch (e) { console.error('[mailsync]', email, folder, e.message); ERRORS.push(`${email} ${folder}: ${e.message}`.slice(0, 200)); continue; }
    for (const m of msgs) {
      if (seen.has(m.id)) continue;
      const inbound = folder === 'inbox';
      const other = inbound ? lower(m.from) : (m.to.map(lower).find((t) => map.has(t)) || '');
      const t = map.get(other); if (!t || (!t.deal && !t.client)) continue;
      const at = D.localIso(new Date(m.at)).slice(0, 16);
      // The CRM logs its own sends as "Email sent" without a mail id; skip the Sent Items copy of those on the
      // timeline. The conversation keeps it: threads.logMail folds the copy into the message the CRM logged.
      const ownSend = !inbound && acts.some((a) => a.type === 'email' && !a.mailId && a.deal === t.deal && Math.abs(new Date(a.at) - new Date(m.at)) < 15 * 60e3);
      if (!ownSend) D.putRecord('activity', { id: Date.now() + Math.floor(Math.random() * 1e5), deal: t.deal, client: t.client, type: 'email', who: uid, text: `Email ${inbound ? 'from' : 'to'} ${t.name}: ${m.subject}`.slice(0, 160), detail: String(m.preview || '').slice(0, 240), at, mailId: m.id, url: m.url || '' }, 'system');
      // The conversation on the card gets the full text where it can be fetched, otherwise the preview.
      let body = String(m.preview || ''); try { const full = await mailbox.message(uid, email, m.id); if (full && full.text) body = full.text; } catch (_) { /* the preview will do */ }
      const th = threads.logMail({ deal: t.deal, client: t.client, name: t.name, addr: t.addr, subject: m.subject, conv: m.conv, inbound, from: inbound ? (m.fromName || m.from) : '', at, body, mailId: m.id, url: m.url || '', uid });
      if (inbound && t.owner && t.owner !== 'unassigned') {
        await notify('reply', [t.owner], { title: `${t.name} replied: ${m.subject}`.slice(0, 120), body: String(m.preview || '').slice(0, 120), url: '#/deal/' + t.deal, kind: 'reply', id: th ? th.id : t.deal }).catch(() => {});
      }
      seen.add(m.id); n++;
    }
  }
  return n;
}
// History: the regular pass only reads the newest 25 messages per folder, and mail synced before the conversation
// view existed only reached the timeline. Once per deal address and mailbox, every message with that address
// (all folders, up to 100) is added to the conversation and, if missing, the timeline, at its real date, without
// alerts and without marking anything unread. `force` re-runs it (the Load full history button on the card).
const BF_PER_RUN = 15;
async function backfillDeal(uid, email, t, { force = false } = {}) {
  const key = `mbf:${lower(email)}:${t.addr}`;
  if (!force && D.cache.get(key)) return 0;
  let msgs; try { msgs = await mailbox.withAddress(uid, email, t.addr, 100); } catch (e) { console.error('[mailsync] history', email, t.addr, e.message); ERRORS.push(`${email} history: ${e.message}`.slice(0, 200)); return 0; }
  const inThreads = new Set(D.listCol('threads').filter((x) => x.deal === t.deal).flatMap((x) => (x.msgs || []).map((m) => m.mailId)).filter(Boolean));
  const acts = D.listCol('activity'); const seen = new Set(acts.filter((a) => a.mailId).map((a) => a.mailId));
  let n = 0;
  for (const m of msgs.slice().sort((a, b) => String(a.at).localeCompare(String(b.at)))) {
    const from = lower(m.from); const inbound = from === t.addr; const outbound = from === lower(email);
    if (!inbound && !outbound) continue; // someone else on the thread; the conversation is between us and the contact
    if (outbound && ![...m.to, ...m.cc].map(lower).includes(t.addr)) continue;
    if (inThreads.has(m.id)) continue;
    const at = D.localIso(new Date(m.at)).slice(0, 16);
    if (!seen.has(m.id)) {
      const ownSend = outbound && acts.some((a) => a.type === 'email' && !a.mailId && a.deal === t.deal && Math.abs(new Date(a.at) - new Date(m.at)) < 15 * 60e3);
      if (!ownSend) D.putRecord('activity', { id: Date.now() + Math.floor(Math.random() * 1e5), deal: t.deal, client: t.client, type: 'email', who: uid, text: `Email ${inbound ? 'from' : 'to'} ${t.name}: ${m.subject}`.slice(0, 160), detail: String(m.text || '').replace(/\s+/g, ' ').slice(0, 240), at, mailId: m.id, url: m.url || '' }, 'system');
    }
    threads.logMail({ deal: t.deal, client: t.client, name: t.name, addr: t.addr, subject: m.subject, conv: m.conv, inbound, from: inbound ? (m.fromName || m.from) : '', at, body: m.text || '', mailId: m.id, url: m.url || '', uid, quiet: true });
    inThreads.add(m.id); n++;
  }
  D.cache.set(key, { at: D.nowIso(), n });
  return n;
}
// Load full history for one deal from every connected mailbox. Returns the number of messages added.
async function backfill(dealId) {
  const d = D.getRecord('deals', dealId); if (!d || !d.email) return 0;
  const t = { deal: d.id, client: d.client || 0, name: d.contact || d.practice, owner: d.owner || '', addr: lower(d.email) };
  let n = 0; for (const a of mailbox.accounts()) n += await backfillDeal(a.user, a.email, t, { force: true });
  return n;
}
// Errors from the last syncAll (a mailbox whose sign-in expired, Graph refusing a folder), for the job's health check.
let ERRORS = [];
const lastErrors = () => ERRORS.slice();
async function syncAll() {
  ERRORS = [];
  let n = 0; const accts = mailbox.accounts();
  for (const a of accts) n += await syncAccount(a.user, a.email);
  // A few deals' history per run, so a first sync of a big pipeline is spread out.
  let budget = BF_PER_RUN; const deals = [...targets().values()].filter((t) => t.deal);
  for (const a of accts) for (const t of deals) { if (budget <= 0) break; if (D.cache.get(`mbf:${lower(a.email)}:${t.addr}`)) continue; await backfillDeal(a.user, a.email, t); budget--; }
  return n;
}
module.exports = { syncAll, syncAccount, backfill, backfillDeal, lastErrors, enabled: () => mailbox.enabled() };
