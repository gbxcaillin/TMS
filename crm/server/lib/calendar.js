'use strict';
// Two-way sync between the CRM's shared calendar and each person's Outlook calendar, through the
// mailbox connection they already have (needs the Calendars.ReadWrite scope, granted on reconnect).
//   pull(): every 15 minutes, each connected calendar's events for the window are mirrored into the
//           CRM `events` collection. The same meeting on two people's calendars becomes one CRM event
//           (matched on iCalUId) with both people on it. Private items show as "Private".
//   push(): an event created, edited or deleted in the CRM is written to the Outlook calendar of every
//           person on it who has a connected calendar. Mappings live in event.ext.map[mailbox] = Outlook id.
// Mappings are keyed by mailbox address (one person can connect several), so pulling one mailbox never
// disturbs what another mailbox of the same person contributed. Pulled changes are written with the system
// actor, so they never re-trigger push.
const D = require('./db');
const mailbox = require('./mailbox');
const TZ = process.env.TZ || 'Australia/Melbourne';
const BASE = process.env.APP_URL || 'https://portal.brightday.com.au';
const WINDOW = { back: 30, ahead: 90 };
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SELECT = 'id,iCalUId,subject,start,end,isAllDay,isCancelled,sensitivity,location,bodyPreview,webLink,lastModifiedDateTime';

async function g(tok, method, path, body) {
  const r = await fetch(path.startsWith('http') ? path : GRAPH + path, { method, headers: { authorization: 'Bearer ' + tok, Prefer: `outlook.timezone="${TZ}"`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 204) return {};
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Graph ' + method + ' ' + path.replace(GRAPH, '') + ': ' + r.status + ' ' + (j.error ? j.error.message : ''));
  return j;
}
const iso = (d) => D.localIso(d).slice(0, 10);
function windowDates() { const a = new Date(); a.setDate(a.getDate() - WINDOW.back); const b = new Date(); b.setDate(b.getDate() + WINDOW.ahead); return { from: iso(a), to: iso(b) }; }
const addDays = (day, n) => { const d = new Date(day + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };

// Outlook event -> CRM fields.
function fromGraph(ev) {
  const allDay = !!ev.isAllDay;
  const s = String((ev.start || {}).dateTime || '').slice(0, 16), e = String((ev.end || {}).dateTime || '').slice(0, 16);
  const priv = ev.sensitivity === 'private' || ev.sensitivity === 'confidential';
  return {
    title: priv ? 'Private' : (ev.subject || '(no subject)'), kind: 'Outlook', allDay,
    start: allDay ? s.slice(0, 10) : s, end: allDay ? addDays(e.slice(0, 10), -1) : e,     // Graph all-day ends at the next midnight
    notes: priv ? '' : [ev.location && ev.location.displayName ? 'Where: ' + ev.location.displayName : '', String(ev.bodyPreview || '').slice(0, 400)].filter(Boolean).join('\n'),
  };
}
// CRM event -> Outlook body.
function toGraph(e) {
  const deal = e.deal ? D.getRecord('deals', e.deal) : null;
  const body = [e.notes || '', deal ? 'Deal: ' + deal.practice : '', 'From Brightday Portal: ' + BASE + '/#/calendar'].filter(Boolean).join('\n\n');
  const start = e.allDay ? e.start.slice(0, 10) + 'T00:00:00' : e.start.slice(0, 16) + ':00';
  const end = e.allDay ? addDays((e.end || e.start).slice(0, 10), 1) + 'T00:00:00' : (e.end || e.start).slice(0, 16) + ':00';
  return { subject: e.title || 'Event', isAllDay: !!e.allDay, start: { dateTime: start, timeZone: TZ }, end: { dateTime: end, timeZone: TZ }, body: { contentType: 'text', content: body }, showAs: e.kind === 'Out of office' ? 'oof' : 'busy' };
}
const same = (a, b) => ['title', 'start', 'end', 'allDay', 'notes'].every((k) => (a[k] || '') === (b[k] || ''));
const ext = (e) => { const x = (e.ext && typeof e.ext === 'object') ? { origin: e.ext.origin || 'crm', ical: e.ext.ical || '', mod: e.ext.mod || '', map: { ...(e.ext.map || {}) }, links: { ...(e.ext.links || {}) } } : { origin: 'crm', ical: '', mod: '', map: {}, links: {} }; for (const k of Object.keys(x.map)) if (!k.includes('@')) delete x.map[k]; return x; };
const emailsOf = (uid) => mailbox.calendarAccounts().filter((a) => a.user === uid).map((a) => a.email);

// Mirror one person's Outlook calendar into the CRM. Returns { added, updated, removed }.
async function pull(uid, email) {
  const tok = await mailbox.calendarToken(uid, email);
  const { from, to } = windowDates();
  const items = []; let url = `/me/calendarView?startDateTime=${from}T00:00:00&endDateTime=${to}T23:59:59&$top=200&$select=${SELECT}`;
  try { for (let page = 0; url && page < 5; page++) { const j = await g(tok, 'GET', url); items.push(...(j.value || [])); url = j['@odata.nextLink'] || ''; } }
  catch (e) {
    // No Exchange calendar behind this address (no mailbox licence, or hosted elsewhere): stop trying and say so.
    if (/inactive|soft-deleted|on-premise|MailboxNotEnabled|ErrorInvalidUser/i.test(e.message)) { mailbox.flagCalendar(uid, email, 'No Outlook calendar on this account: ' + e.message.replace(/^Graph GET [^:]*: \d+ /, '')); }
    throw e;
  }
  const events = D.listCol('events');
  const byGraph = new Map(), byIcal = new Map();
  for (const e of events) { const x = ext(e); if (x.map[email]) byGraph.set(x.map[email], e); if (x.ical) byIcal.set(x.ical, e); }
  const seen = new Set(); let added = 0, updated = 0, removed = 0;
  for (const ev of items) {
    if (ev.isCancelled) continue;
    seen.add(ev.id);
    const f = fromGraph(ev);
    let e = byGraph.get(ev.id) || (ev.iCalUId ? byIcal.get(ev.iCalUId) : null);
    if (e) {
      const x = ext(e); const who = [...new Set([...(e.who || []), uid])];
      // Two people's copies of one meeting can differ for a while; the most recently modified copy wins.
      const mod = String(ev.lastModifiedDateTime || '');
      const changed = !same(e, f) && x.origin === 'outlook' && mod >= (x.mod || '');
      const mapChanged = x.map[email] !== ev.id || (!x.links[uid] && ev.webLink) || (ev.iCalUId && x.ical !== ev.iCalUId) || who.length !== (e.who || []).length;
      if (changed || mapChanged) {
        x.map[email] = ev.id; if (!x.links[uid] || changed) x.links[uid] = ev.webLink || ''; if (ev.iCalUId) x.ical = ev.iCalUId; if (changed) x.mod = mod;
        const next = { ...e, ...(changed ? f : {}), who, ext: x };
        D.putRecord('events', next, 'system'); if (changed) updated++;
      }
    } else {
      const rec = { id: D.nextId('events'), ...f, who: [uid], deal: 0, ext: { origin: 'outlook', ical: ev.iCalUId || '', mod: String(ev.lastModifiedDateTime || ''), map: { [email]: ev.id }, links: { [uid]: ev.webLink || '' } } };
      D.putRecord('events', rec, 'system'); byIcal.set(rec.ext.ical, rec); byGraph.set(ev.id, rec); added++;
    }
  }
  // Gone from this mailbox inside the window: drop this mailbox's copy; the person leaves the event only when
  // none of their mailboxes still has it.
  const mine = emailsOf(uid);
  for (const e of events) {
    const x = ext(e); const gid = x.map[email]; if (!gid || seen.has(gid)) continue;
    const day = String(e.start || '').slice(0, 10); if (day < from || day > to) continue;
    delete x.map[email];
    const stillMine = mine.some((em) => x.map[em]);
    if (!stillMine) delete x.links[uid];
    const who = stillMine ? (e.who || []) : (e.who || []).filter((w) => w !== uid);
    if (x.origin === 'outlook' && !who.length) { D.delRecord('events', e.id, 'system'); removed++; }
    else D.putRecord('events', { ...e, who: x.origin === 'outlook' ? who : e.who, ext: x }, 'system');
  }
  return { added, updated, removed };
}

// Write a CRM-side change to the Outlook calendars of the people on the event.
async function push(prev, next, actor) {
  if (!mailbox.enabled()) return;
  const accounts = mailbox.calendarAccounts();
  const byEmail = (em) => accounts.find((a) => a.email === em);
  const del = async (em, gid) => { const a = byEmail(em); if (!a) return; try { await g(await mailbox.calendarToken(a.user, em), 'DELETE', `/me/events/${encodeURIComponent(gid)}`); } catch (e) { console.error('[calendar] delete', e.message); } };
  if (!next) {   // deleted in the CRM
    const x = ext(prev || {});
    for (const [em, gid] of Object.entries(x.map)) await del(em, gid);
    return;
  }
  const x = ext(next); let dirty = false;
  const body = toGraph(next);
  for (const uid of next.who || []) {
    const mine = accounts.filter((a) => a.user === uid); if (!mine.length) continue;
    const mapped = mine.find((a) => x.map[a.email]);
    try {
      if (mapped) { if (!prev || !same(prev, next)) await g(await mailbox.calendarToken(uid, mapped.email), 'PATCH', `/me/events/${encodeURIComponent(x.map[mapped.email])}`, body); }
      else { const a = mine[0]; const j = await g(await mailbox.calendarToken(uid, a.email), 'POST', '/me/events', body); x.map[a.email] = j.id; x.links[uid] = j.webLink || ''; dirty = true; }
    } catch (e) { console.error('[calendar] push', uid, e.message); }
  }
  for (const em of Object.keys(x.map)) {   // taken off the event in the CRM
    const a = byEmail(em); if (!a || (next.who || []).includes(a.user)) continue;
    await del(em, x.map[em]); delete x.map[em]; delete x.links[a.user]; dirty = true;
  }
  if (dirty) { const cur = D.getRecord('events', next.id); if (cur) D.putRecord('events', { ...cur, ext: x }, 'system'); }
}

async function syncUser(uid) {
  const out = { accounts: 0, added: 0, updated: 0, removed: 0, errors: [] };
  for (const a of mailbox.calendarAccounts().filter((a) => a.user === uid)) {
    try { const r = await pull(uid, a.email); out.accounts++; out.added += r.added; out.updated += r.updated; out.removed += r.removed; }
    catch (e) { out.errors.push(a.email + ': ' + e.message); console.error('[calendar] pull', a.email, e.message); }
  }
  return out;
}
async function syncAll() {
  let n = 0; const users = new Set(mailbox.calendarAccounts().map((a) => a.user));
  for (const uid of users) { const r = await syncUser(uid); n += r.added + r.updated + r.removed; }
  return n;
}
module.exports = { pull, push, syncUser, syncAll, fromGraph, toGraph, enabled: () => mailbox.enabled() };
