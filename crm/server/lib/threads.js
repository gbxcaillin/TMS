'use strict';
// Email conversations on the deal card. Every email to or from a lead's or client's address, whether it arrived
// in a connected mailbox, was sent from one through the CRM, or was sent from the CRM's own address, is kept as
// a message in a `threads` record for that deal, so the Email tab on the card reads as one conversation with
// the contact. A thread is one Outlook conversation when we know it, otherwise one subject line (Re: stripped).
const D = require('./db');

const norm = (s) => String(s || '').replace(/^\s*((re|fwd?|aw|wg)\s*:\s*)+/i, '').trim().toLowerCase().slice(0, 120);
// Stable numeric id from the deal and the conversation key, so the same conversation always lands in one record.
function threadId(deal, key) { let h = 2166136261; const s = deal + '|' + key; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return 1e9 + (h % 1e9); }

/**
 * logMail({ deal, client, name, addr, subject, conv, inbound, from, at, body, mailId, url, uid })
 * Appends one message to the deal's thread for that conversation (creating it), skipping duplicates by mail id or,
 * for messages without one (the CRM's own sends), by direction, time and text. Returns the thread or null.
 */
function logMail(o) {
  if (!o.deal) return null;
  // Find the deal's thread for this conversation: the Outlook conversation id when both sides know it, else the
  // subject line, so a CRM send (no conversation id yet) and its Sent Items copy and reply (which have one) meet.
  const subj = norm(o.subject);
  const mine = D.listCol('threads').filter((x) => x.deal === o.deal);
  const t = (o.conv && mine.find((x) => x.conv === o.conv)) || mine.find((x) => norm(x.subject) === subj)
    || { id: threadId(o.deal, o.conv ? 'c:' + o.conv : 's:' + subj), deal: o.deal, client: o.client || 0, from: o.name || o.addr || '', addr: o.addr || '', subject: String(o.subject || '(no subject)').slice(0, 200), conv: o.conv || '', folder: 'inbox', unread: false, at: o.at, msgs: [] };
  if (o.mailId && t.msgs.some((m) => m.mailId === o.mailId)) return t;
  const near = (m) => !!m.out === !o.inbound && Math.abs(new Date(m.at) - new Date(o.at)) < 15 * 60e3 && (m.body || '').slice(0, 80) === String(o.body || '').slice(0, 80);
  const twin = t.msgs.find(near);
  if (twin) { if (o.mailId && !twin.mailId) { twin.mailId = o.mailId; twin.url = o.url || twin.url; D.putRecord('threads', t, 'system'); } return t; }
  t.msgs.push({ from: o.from || (o.inbound ? t.from : 'You'), out: !o.inbound, at: o.at, body: String(o.body || '').slice(0, 20000), mailId: o.mailId || '', url: o.url || '', who: o.inbound ? '' : (o.uid || '') });
  t.msgs.sort((a, b) => new Date(a.at) - new Date(b.at));
  const last = t.msgs[t.msgs.length - 1];
  t.at = last.at; t.folder = last.out ? 'sent' : 'inbox'; if (o.inbound && !o.quiet) t.unread = true;
  if (!t.conv && o.conv) t.conv = o.conv;
  D.putRecord('threads', t, 'system');
  return t;
}
// The deal (and client) a contact address belongs to, newest open deal first.
function targetFor(addr) {
  const a = String(addr || '').toLowerCase().trim(); if (!a) return null;
  const closed = new Set((D.kvGet('stages') || []).filter((s) => s.closed).map((s) => s.id));
  const deals = D.listCol('deals').filter((d) => String(d.email || '').toLowerCase().trim() === a).sort((x, y) => (closed.has(x.stage) - closed.has(y.stage)) || String(y.created || '').localeCompare(String(x.created || '')));
  if (deals.length) { const d = deals[0]; return { deal: d.id, client: d.client || 0, name: d.contact || d.practice, owner: d.owner || '', addr: a }; }
  const c = D.listCol('clients').find((c) => String(c.email || '').toLowerCase().trim() === a);
  if (c) return { deal: (c.deals || [])[0] || 0, client: c.id, name: c.contact || c.name, owner: c.owner || '', addr: a };
  return null;
}
module.exports = { logMail, targetFor, threadId, norm };
