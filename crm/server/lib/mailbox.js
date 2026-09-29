'use strict';
// Per-user Microsoft 365 mailbox connection (delegated OAuth, authorization code + PKCE).
// A user connects their own inbox so the CRM can read recent mail, draft replies and send as
// them. Tokens live server-side only, encrypted at rest via the vault, and are NEVER synced to
// browsers. Reuses the sign-in app if configured, else the SharePoint app. On that Azure app add:
//   Delegated permissions: Mail.Read, Mail.Send, offline_access, openid, email  (grant consent)
//   Redirect URI (Web): <APP_URL>/api/v1/mail/connect/callback
const crypto = require('node:crypto');
const D = require('./db');

// Mailboxes use the MS_* app (the one with the Mail permissions and the mail callback URI). Refresh tokens are
// bound to the app that issued them, so switching apps when SSO_* is added would invalidate every connected
// mailbox; SSO_* is only a fallback for installs that never set MS_*.
const CID = process.env.MS_CLIENT_ID || process.env.SSO_CLIENT_ID;
const SECRET = process.env.MS_CLIENT_SECRET || process.env.SSO_CLIENT_SECRET;
const TENANT = process.env.MS_TENANT_ID || process.env.SSO_TENANT;
const BASE = process.env.APP_URL || 'https://crm.example.com';
const REDIRECT = BASE + '/api/v1/mail/connect/callback';
const SCOPES = 'openid email offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send';
// Calendar sync (lib/calendar.js) needs one more delegated scope. New connections ask for it up front; older ones
// keep working for mail and show "Reconnect to sync calendar" until the person reconnects.
const CAL_SCOPE = 'https://graph.microsoft.com/Calendars.ReadWrite';
const CONNECT_SCOPES = SCOPES + ' ' + CAL_SCOPE;
const CACHE_KEY = 'mail:accounts';
const enabled = () => !!(CID && SECRET && TENANT);
const b64u = (b) => Buffer.from(b).toString('base64url');
const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function authUrl() {
  const state = b64u(crypto.randomBytes(24)), verifier = b64u(crypto.randomBytes(32));
  const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
  const q = new URLSearchParams({ client_id: CID, response_type: 'code', redirect_uri: REDIRECT, response_mode: 'query', scope: CONNECT_SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' });
  return { url: `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize?${q}`, state, verifier };
}
async function tokenReq(params) {
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: CID, client_secret: SECRET, redirect_uri: REDIRECT, ...params }) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error_description || j.error || 'Token request failed'); return j;
}
function emailFromIdToken(idt) { try { const p = JSON.parse(Buffer.from(String(idt).split('.')[1], 'base64url')); return String(p.email || p.preferred_username || '').toLowerCase(); } catch (_) { return ''; } }

// Encrypted, server-only store (market_cache table + vault). Never enters snapshot/sync.
function load() { const raw = D.cache.get(CACHE_KEY); if (!raw) return []; try { return JSON.parse(D.vault.open(raw)); } catch (_) { return []; } }
function persist(list) { D.cache.set(CACHE_KEY, D.vault.seal(JSON.stringify(list))); }
// What the client is allowed to see: address + when connected, no tokens.
function listFor(uid) { return load().filter((a) => a.user === uid).map((a) => ({ email: a.email, at: a.at, calendar: a.calendar === true, calendarError: a.calError || '' })); }
// Mark a mailbox's calendar as unusable with a reason (shown under Settings, Email accounts); the sync job skips it.
function flagCalendar(uid, email, reason) { const list = load(); const a = list.find((x) => x.user === uid && x.email === email); if (!a) return; a.calendar = false; a.calError = String(reason || '').slice(0, 200); persist(list); }
// Every connected mailbox whose calendar scope has been granted (for the sync job).
function calendarAccounts() { return load().filter((a) => a.calendar === true).map((a) => ({ user: a.user, email: a.email })); }

async function connect(uid, code, verifier) {
  const j = await tokenReq({ grant_type: 'authorization_code', code, code_verifier: verifier, scope: CONNECT_SCOPES });
  const email = emailFromIdToken(j.id_token);
  if (!email) throw new Error('Could not read the mailbox address from Microsoft');
  const list = load().filter((a) => !(a.user === uid && a.email === email));
  list.push({ user: uid, email, refresh: j.refresh_token, access: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000, at: D.nowIso(), calendar: true });
  persist(list);
  return { email };
}
function remove(uid, email) { persist(load().filter((a) => !(a.user === uid && a.email === String(email).toLowerCase()))); }

// A valid access token for one connected mailbox, refreshing (and rotating the refresh token) as needed.
async function accessToken(uid, email) {
  const list = load(); const a = list.find((x) => x.user === uid && x.email === email);
  if (!a) throw new Error('That mailbox is not connected');
  if (a.access && a.exp > Date.now() + 60000) return a.access;
  const j = await tokenReq({ grant_type: 'refresh_token', refresh_token: a.refresh, scope: SCOPES });
  a.access = j.access_token; a.exp = Date.now() + (j.expires_in || 3600) * 1000; if (j.refresh_token) a.refresh = j.refresh_token;
  persist(list); return a.access;
}
// A token carrying the calendar scope. Fails (and flags the account) when the person connected before calendar
// sync existed and has not reconnected, so the mail side is never affected.
async function calendarToken(uid, email) {
  const list = load(); const a = list.find((x) => x.user === uid && x.email === email);
  if (!a) throw new Error('That mailbox is not connected');
  if (a.calAccess && a.calExp > Date.now() + 60000) return a.calAccess;
  try {
    const j = await tokenReq({ grant_type: 'refresh_token', refresh_token: a.refresh, scope: 'offline_access ' + CAL_SCOPE });
    a.calAccess = j.access_token; a.calExp = Date.now() + (j.expires_in || 3600) * 1000; if (j.refresh_token) a.refresh = j.refresh_token; a.calendar = true; a.calError = '';
    persist(list); return a.calAccess;
  } catch (e) { a.calendar = false; a.calError = String(e.message || e).slice(0, 200); persist(list); throw new Error('Calendar access not granted for ' + email + ' (reconnect the mailbox to enable calendar sync)'); }
}
async function gget(tok, path) {
  const r = await fetch('https://graph.microsoft.com/v1.0' + path, { headers: { authorization: 'Bearer ' + tok } });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error('Graph ' + path + ': ' + r.status + ' ' + (j.error ? j.error.message : '')); return j;
}
// Every connected mailbox (for background jobs).
function accounts() { return load().map((a) => ({ user: a.user, email: a.email })); }
// Recent messages in a folder with the fields the timeline needs.
async function recentIn(uid, email, folder = 'inbox', top = 25) {
  const tok = await accessToken(uid, email);
  const j = await gget(tok, `/me/mailFolders/${folder}/messages?$top=${top}&$select=id,conversationId,subject,from,toRecipients,receivedDateTime,sentDateTime,bodyPreview,webLink`);
  return (j.value || []).map((m) => ({ id: m.id, conv: m.conversationId || '', subject: m.subject || '(no subject)', from: (m.from && m.from.emailAddress && m.from.emailAddress.address) || '', fromName: (m.from && m.from.emailAddress && m.from.emailAddress.name) || '', to: (m.toRecipients || []).map((r) => (r.emailAddress && r.emailAddress.address) || '').filter(Boolean), at: m.receivedDateTime || m.sentDateTime, preview: m.bodyPreview || '', url: m.webLink }));
}
// Recent inbox messages for one connected mailbox.
async function recent(uid, email, top = 20) {
  const tok = await accessToken(uid, email);
  const j = await gget(tok, `/me/mailFolders/inbox/messages?$top=${top}&$select=id,conversationId,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead,webLink`);
  return (j.value || []).map((m) => ({ id: m.id, conv: m.conversationId, subject: m.subject || '(no subject)', from: (m.from && m.from.emailAddress && m.from.emailAddress.address) || '', fromName: (m.from && m.from.emailAddress && m.from.emailAddress.name) || '', at: m.receivedDateTime, preview: m.bodyPreview || '', read: !!m.isRead, url: m.webLink, account: email }));
}
// Plain text from an HTML email body, so the reading pane never renders untrusted HTML.
function htmlToText(h) {
  return String(h || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n').replace(/<br\s*\/?>(?!\n)/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
// One message with its full body. Inline (cid:) images that arrive as attachments are
// embedded as data: URIs so they render like Outlook; remote https images load as-is.
// Inline images arrive as attachments referenced by cid: in the HTML. Graph's hasAttachments is false when
// every attachment is inline, so the trigger is the HTML itself, not that flag. Senders are loose about the
// identifier: contentId with or without angle brackets, a different case, or none at all with the file name
// standing in (Microsoft's own Bookings mail does this), so matching falls back step by step.
const hasCid = (html) => /src\s*=\s*["']?cid:/i.test(String(html || ''));
const TRANSPARENT = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
function applyCids(html, attachments) {
  const imgs = (attachments || []).filter((a) => a.contentBytes && /^image\//i.test(a.contentType || '') && !(a.size && a.size > 6 * 1024 * 1024));
  const norm = (v) => String(v || '').replace(/^<|>$/g, '').trim().toLowerCase();
  const used = new Set();
  const find = (cid) => {
    const c = norm(decodeURIComponent(cid)); const short = c.split('@')[0];
    return imgs.find((a) => norm(a.contentId) === c) || imgs.find((a) => norm(a.name) === c) || imgs.find((a) => norm(a.contentId).split('@')[0] === short) || imgs.find((a) => norm(a.name) === short) || null;
  };
  let out = String(html).replace(/(src\s*=\s*)(["']?)cid:([^"'\s>]+)\2/gi, (m, pre, q, cid) => {
    const a = find(cid); if (!a) return m; used.add(a);
    return `${pre}${q || '"'}data:${a.contentType};base64,${a.contentBytes}${q || '"'}`;
  });
  // One reference left and one image left: pair them. Anything still unresolved becomes a blank pixel, not a broken icon.
  const left = imgs.filter((a) => !used.has(a));
  const refs = out.match(/src\s*=\s*["']?cid:/gi) || [];
  if (refs.length === 1 && left.length === 1) out = out.replace(/(src\s*=\s*)(["']?)cid:([^"'\s>]+)\2/i, (m, pre, q) => `${pre}${q || '"'}data:${left[0].contentType};base64,${left[0].contentBytes}${q || '"'}`);
  return out.replace(/(src\s*=\s*)(["']?)cid:([^"'\s>]+)\2/gi, (m, pre, q) => `${pre}${q || '"'}${TRANSPARENT}${q || '"'}`);
}
async function inlineCidImages(tok, id, html) {
  if (!hasCid(html)) return html;
  let at; try { at = await gget(tok, `/me/messages/${encodeURIComponent(id)}/attachments?$select=name,contentType,contentId,isInline,contentBytes,size`); } catch (_) { return html; }
  return applyCids(html, at.value || []);
}
// The file (non-inline) attachments on a message: metadata only. Bytes are fetched on demand by
// attachment(). Inline images (rendered in the body) and non-file attachments are excluded.
async function fileAttachments(tok, id) {
  let at; try { at = await gget(tok, `/me/messages/${encodeURIComponent(id)}/attachments?$select=id,name,contentType,size,isInline`); } catch (_) { return []; }
  return (at.value || [])
    .filter((a) => a['@odata.type'] === '#microsoft.graph.fileAttachment' && !a.isInline)
    .map((a) => ({ attId: a.id, name: a.name || 'attachment', size: a.size || 0, contentType: a.contentType || 'application/octet-stream' }));
}
// One attachment's bytes, for download or saving to SharePoint.
async function attachment(uid, email, id, attId) {
  const tok = await accessToken(uid, email);
  const a = await gget(tok, `/me/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attId)}?$select=name,contentType,contentBytes,size`);
  if (!a.contentBytes) throw new Error('That attachment has no downloadable content (it may be a linked file — open it in Outlook)');
  return { name: a.name || 'attachment', contentType: a.contentType || 'application/octet-stream', buffer: Buffer.from(a.contentBytes, 'base64') };
}
async function message(uid, email, id) {
  const tok = await accessToken(uid, email);
  const m = await gget(tok, `/me/messages/${encodeURIComponent(id)}?$select=id,conversationId,subject,from,toRecipients,receivedDateTime,body,webLink,hasAttachments`);
  const html = m.body && m.body.contentType === 'html';
  let raw = m.body ? m.body.content : '';
  if (html && hasCid(raw)) raw = await inlineCidImages(tok, id, raw);
  const attachments = m.hasAttachments ? await fileAttachments(tok, id) : [];
  return { id: m.id, conv: m.conversationId, subject: m.subject || '(no subject)', from: (m.from && m.from.emailAddress && m.from.emailAddress.address) || '', fromName: (m.from && m.from.emailAddress && m.from.emailAddress.name) || '', at: m.receivedDateTime, text: html ? htmlToText(raw) : raw, html: html ? raw : '', url: m.webLink, account: email, attachments };
}
// Every message in this mailbox (all folders) with `addr` as sender or recipient, newest first, up to `limit`, with
// plain-text bodies. Used to back-fill a deal's email conversation with the history from before it was synced.
async function withAddress(uid, email, addr, limit = 100) {
  const tok = await accessToken(uid, email); const out = [];
  const q = encodeURIComponent(`"participants:${String(addr).replace(/"/g, '')}"`);
  let path = `/me/messages?$search=${q}&$top=50&$select=id,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,body,webLink,isDraft`;
  while (path && out.length < limit) {
    const j = await gget(tok, path);
    for (const m of j.value || []) {
      if (m.isDraft) continue;
      const isHtml = m.body && m.body.contentType === 'html'; const raw = m.body ? m.body.content : '';
      const addrs = (list) => (list || []).map((r) => (r.emailAddress && r.emailAddress.address) || '').filter(Boolean);
      out.push({ id: m.id, conv: m.conversationId || '', subject: m.subject || '(no subject)', from: (m.from && m.from.emailAddress && m.from.emailAddress.address) || '', fromName: (m.from && m.from.emailAddress && m.from.emailAddress.name) || '', to: addrs(m.toRecipients), cc: addrs(m.ccRecipients), at: m.sentDateTime || m.receivedDateTime, text: isHtml ? htmlToText(raw) : raw, url: m.webLink });
    }
    path = j['@odata.nextLink'] ? j['@odata.nextLink'].replace('https://graph.microsoft.com/v1.0', '') : '';
  }
  return out.slice(0, limit);
}
// All messages in one conversation (inbound + your sent replies), oldest first, for a thread view.
async function conversation(uid, email, convId, top = 25) {
  const tok = await accessToken(uid, email);
  const filter = encodeURIComponent(`conversationId eq '${String(convId).replace(/'/g, "''")}'`);
  // Graph rejects $filter on conversationId combined with $orderby ("restriction or sort order is too complex"), so sort here.
  const j = await gget(tok, `/me/messages?$filter=${filter}&$top=${top}&$select=id,subject,from,toRecipients,receivedDateTime,sentDateTime,body,webLink,isRead,hasAttachments`);
  const msgs = (j.value || []).slice().sort((a, b) => String(a.receivedDateTime || a.sentDateTime || '').localeCompare(String(b.receivedDateTime || b.sentDateTime || '')));
  const out = [];
  for (const m of msgs) {
    const isHtml = m.body && m.body.contentType === 'html';
    let raw = m.body ? m.body.content : '';
    if (isHtml && hasCid(raw)) raw = await inlineCidImages(tok, m.id, raw);
    const fromAddr = (m.from && m.from.emailAddress && m.from.emailAddress.address) || '';
    const attachments = m.hasAttachments ? await fileAttachments(tok, m.id) : [];
    out.push({ id: m.id, subject: m.subject || '', from: fromAddr, fromName: (m.from && m.from.emailAddress && m.from.emailAddress.name) || '', to: (m.toRecipients || []).map((r) => r.emailAddress && r.emailAddress.address).filter(Boolean), at: m.receivedDateTime || m.sentDateTime, html: isHtml ? raw : '', text: isHtml ? htmlToText(raw) : raw, url: m.webLink, out: fromAddr.toLowerCase() === String(email).toLowerCase(), attachments });
  }
  return out;
}
// Graph call with an optional JSON body, for message housekeeping (returns {} on 204).
async function gsend(tok, method, path, body) {
  const r = await fetch('https://graph.microsoft.com/v1.0' + path, { method, headers: { authorization: 'Bearer ' + tok, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error('Graph ' + path + ': ' + r.status + ' ' + (j.error ? j.error.message : '')); }
  return r.status === 204 ? {} : r.json().catch(() => ({}));
}
// Housekeeping on one or more messages: mark read/unread, archive, or delete (to Deleted Items).
async function actOnMessages(uid, email, ids, action) {
  const tok = await accessToken(uid, email);
  let done = 0;
  for (const id of ids) {
    const p = `/me/messages/${encodeURIComponent(id)}`;
    if (action === 'read') await gsend(tok, 'PATCH', p, { isRead: true });
    else if (action === 'unread') await gsend(tok, 'PATCH', p, { isRead: false });
    else if (action === 'archive') await gsend(tok, 'POST', p + '/move', { destinationId: 'archive' });
    else if (action === 'delete') await gsend(tok, 'DELETE', p);
    else throw new Error('Unknown action');
    done++;
  }
  return { done };
}
// Send from a connected mailbox (new message, or a reply when replyTo message id is given).
async function send(uid, email, { to, subject, body, replyTo }) {
  const tok = await accessToken(uid, email);
  const html = `<div style="white-space:pre-wrap;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55">${escHtml(body)}</div>`;
  let path = '/me/sendMail', payload = { message: { subject, body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: to } }] }, saveToSentItems: true };
  if (replyTo) { path = `/me/messages/${encodeURIComponent(replyTo)}/reply`; payload = { message: { toRecipients: [{ emailAddress: { address: to } }] }, comment: body }; }
  const r = await fetch('https://graph.microsoft.com/v1.0' + path, { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error('Send failed: ' + r.status + ' ' + (j.error ? j.error.message : '')); }
  return { sent: true };
}
module.exports = { enabled, authUrl, connect, remove, accessToken, calendarToken, calendarAccounts, flagCalendar, accounts, recentIn, withAddress, listFor, recent, message, conversation, attachment, actOnMessages, send, REDIRECT, applyCids };
