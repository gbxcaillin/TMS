'use strict';
// Workspace state: bootstrap snapshot for a signed-in user and the sync endpoint that
// applies client changes record-by-record (last write wins) and fires notification hooks.
const D = require('./db');
const auth = require('./auth');
const push = require('./push');
const graph = require('./graph');
const mail = require('./mail');
const cloudflare = require('./cloudflare');
const claude = require('./claude');
const notify = require('./notify');
const { err } = require('./http');

const SERVER_SETTINGS = (s) => {
  s = s || {};
  s.apiKeys = auth.listApiKeys();
  const st = push.stats7d();
  s.push = { ...(s.push || {}), devices: push.devices(), vapidPublic: push.publicKey, endpoint: '/api/v1/push/subscribe', sent7d: st.sent, failed7d: st.failed };
  s.spSite = process.env.SP_SITE ? graph.SP_SITE.replace(':/', '/') : (s.spSite || 'brightday.sharepoint.com/sites/Clients');
  s.spLibrary = graph.SP_LIBRARY;
  s.spFolder = graph.SP_FOLDER;
  s.storage = s.storage || 'sharepoint';
  for (const e of ((s.notifyPrefs || {}).events || [])) if (e && e.id === 'lead_any' && /unassigned/.test(e.label || '')) e.label = 'Any new lead arrives (admins only)';
  return s;
};
function features() { return { mail: mail.enabled(), mailMode: mail.mode(), sharepoint: graph.enabled(), mailbox: require('./mailbox').enabled(), market: true, push: true, webAnalytics: cloudflare.enabled(), aiAssist: claude.enabled(), bookings: require('./bookings').enabled(), calls: require('./calls').enabled(), callProviders: require('./calls').providers, bookingUrl: require('./nurture').bookingUrl(), demo: process.env.DEMO_DATA === '1', tools: process.env.TOOLS_URL || '/tools/' }; }

/* ---------- visibility: Admins and Managers see everything; Members see the deals and clients they own ---------- */
const access = require('./access');
function perms(user) { return access.resolve(user, D.kvGet('settings') || {}); }
function sectionOn(p, col) { const fn = access.COL_READ[col]; return !fn || !!p[fn]; }
function scopeFor(user) {
  if (perms(user).allRecords) return null;
  const deals = new Set(D.listCol('deals').filter((d) => d.owner === user.id).map((d) => d.id));
  const clients = new Set(D.listCol('clients').filter((c) => c.owner === user.id || (c.deals || []).some((id) => deals.has(id))).map((c) => c.id));
  return { uid: user.id, deals, clients };
}
function visible(scope, col, r) {
  if (!scope || !r) return true;
  switch (col) {
    case 'deals': return r.owner === scope.uid || scope.deals.has(r.id);
    case 'clients': return scope.clients.has(r.id) || r.owner === scope.uid;
    case 'tasks': return !r.deal || scope.deals.has(r.deal) || (r.who || []).includes(scope.uid) || r.by === scope.uid || (r.notify || []).includes(scope.uid);
    case 'activity': return (!r.deal && !r.client) || (r.deal && scope.deals.has(r.deal)) || (r.client && scope.clients.has(r.client));
    case 'threads': case 'files': return !r.deal || scope.deals.has(r.deal);
    case 'invoices': return (r.deal && scope.deals.has(r.deal)) || (r.clientId && scope.clients.has(r.clientId));
    case 'changes': return r.entity === 'deal' ? scope.deals.has(r.ref) : r.entity === 'client' ? scope.clients.has(r.ref) : true;
    case 'calls': return r.who === scope.uid || (r.deal && scope.deals.has(r.deal)) || (!r.deal && !r.who);
    case 'notifs': return !r.to || r.to.includes(scope.uid);
    case 'messages': return true; // room membership is enforced by the front end; DMs are between two members
    default: return true;
  }
}
function filterState(state, scope, p) {
  for (const c of Object.keys(D.COLS)) { if (!state[c]) continue; if (p && !sectionOn(p, c)) { state[c] = []; continue; } if (scope) state[c] = state[c].filter((r) => visible(scope, c, r)); }
  if (p && !p.research && state.watchlist) state.watchlist = [];
  return state;
}

function bootstrap(user, session) {
  const scope = scopeFor(user);
  const p = perms(user);
  const state = require('./archive').shapeState(filterState(D.snapshot(), scope, p));
  state.users = D.users.publicAll();
  const initialised = !!state.settings;
  if (initialised) state.settings = SERVER_SETTINGS(state.settings);
  const sec = securityPolicy();
  return { user: D.users.public(user), perms: p, rev: D.rev(), state, initialised, maxIds: D.maxIds(), features: features(), vapidPublic: push.publicKey, security: { ...sec, mfaEnrolled: !!D.users.get(user.id).totp_secret, via: session ? session.via : 'password' }, server: { time: D.nowIso(), version: require('../package.json').version } };
}
function securityPolicy() { const s = D.kvGet('settings') || {}; const p = s.security || {}; return { mfaRequired: p.mfaRequired || 'admins', sessionHours: Number(p.sessionHours) || 12, sso: require('./oidc').enabled(), passwordLogin: p.passwordLogin !== false, encryption: D.vault.enabled() }; }
function mfaRequiredFor(user) { const p = securityPolicy().mfaRequired; return p === 'all' || (p === 'admins' && user.role === 'Admin'); }

// Strip fields the server owns before persisting client-sent settings.
function cleanSettings(s) {
  s = { ...(s || {}) };
  delete s.apiKeys;
  if (s.push) { const p = { ...s.push }; delete p.devices; delete p.vapidPublic; delete p.endpoint; delete p.sent7d; delete p.failed7d; s.push = p; }
  return s;
}

function applyUserOp(actor, id, data) {
  const u = D.users.get(id);
  const isAdmin = actor.role === 'Admin';
  if (data.role) { const r = access.normRole(data.role); if (!r) throw err(400, 'Unknown access level: ' + data.role); data = { ...data, role: r }; }
  if (!u) {
    if (!isAdmin) throw err(403, 'Only admins can add users');
    return; // creation goes through POST /users (needs an invite token); ignore stray inserts
  }
  const next = { ...u };
  if (isAdmin) { if (data.role) next.role = data.role; if (data.perms !== undefined) next.perms = next.role === 'Admin' ? null : access.cleanPerms(data.perms); if (data.status && ['Active', 'Invited', 'Inactive'].includes(data.status)) next.status = data.status; if (data.email) next.email = String(data.email).toLowerCase(); }
  if (isAdmin || actor.id === id) { if (data.name) next.name = String(data.name).slice(0, 80); if (data.color) next.color = String(data.color).slice(0, 9); if (data.focus != null) next.focus = String(data.focus).slice(0, 120); }
  if (actor.id === id && data.role && data.role !== u.role && !isAdmin) throw err(403, 'You cannot change your own access level');
  if (!isAdmin && data.perms !== undefined && JSON.stringify(data.perms || null) !== JSON.stringify(u.perms ? JSON.parse(u.perms) : null)) throw err(403, 'Only admins can change access');
  if (u.role === 'Admin' && next.role !== 'Admin' && D.users.all().filter((x) => x.role === 'Admin' && x.status === 'Active').length <= 1) throw err(400, 'The workspace needs at least one active admin');
  D.users.update(next);
  if (next.status !== 'Active') auth.destroyUserSessions(id);
}

function applySync(actor, body) {
  const ops = Array.isArray(body.ops) ? body.ops : [];
  const kv = body.kv && typeof body.kv === 'object' ? body.kv : {};
  const base = Number(body.base) || 0;
  const hooks = [];
  D.transaction(() => {
    const scope = scopeFor(actor);
    const p = perms(actor);
    const fnLabel = (fn) => (access.FUNCTIONS.find((f) => f.id === fn) || { label: fn }).label;
    for (const op of ops) {
      if (!op || typeof op.col !== 'string') continue;
      if (op.col === 'users') { if (op.data) applyUserOp(actor, String(op.id), op.data); continue; }
      if (!D.COLS[op.col]) continue;
      const id = String(op.id);
      const wfn = access.COL_WRITE[op.col]; if (wfn && !p[wfn]) throw err(403, 'Your access level does not include ' + fnLabel(wfn));
      if (op.del && access.DELETE_GUARDED.includes(op.col) && !p.deleteRecords) throw err(403, 'Your access level does not allow deleting ' + op.col);
      const prev = D.getRecord(op.col, id);
      if (scope && prev && !visible(scope, op.col, prev)) throw err(403, 'You do not have access to that ' + op.col.replace(/s$/, ''));
      if (scope && op.data && !visible(scope, op.col, op.data) && op.col !== 'deals' && op.col !== 'clients') throw err(403, 'Members can only change their own deals');
      if (op.col === 'rooms' && op.del && prev && prev.kind === 'room' && !p.admin) throw err(403, 'Only an admin can delete a room');
      // Chat: a message is edited, recalled or deleted only by the person who sent it; admins may delete any.
      // Anyone in the room may still update the read and emailed lists on someone else's message.
      if (op.col === 'messages' && prev && prev.who && prev.who !== actor.id) {
        if (op.del) { if (!p.admin) throw err(403, 'Only the sender or an admin can delete a message'); }
        else if (op.data && typeof op.data === 'object') {
          const strip = (m) => { const c = { ...m }; delete c.read; delete c.emailed; return JSON.stringify(c); };
          if (strip(op.data) !== strip(prev)) throw err(403, 'Only the sender can change a message');
        }
      }
      // Research notes: a note is signed off in the signer's own name, by someone other than its author (an admin may
      // sign off their own), and changing the text of a signed-off note needs a fresh sign-off.
      if (op.col === 'securities' && op.data && typeof op.data === 'object' && op.data.noteStatus === 'Approved') {
        const was = prev || {}; const n = op.data;
        if (was.noteStatus !== 'Approved' || was.noteApprovedBy !== n.noteApprovedBy || was.note !== n.note) {
          if (n.noteApprovedBy !== actor.id) throw err(403, 'A research note is signed off in your own name');
          if (n.noteByUid === actor.id && !p.admin) throw err(403, 'Someone other than the author signs off a research note');
        }
      }
      if (op.del) { if (prev) { D.delRecord(op.col, id, actor.id); hooks.push([op.col, prev, null]); } continue; }
      if (!op.data || typeof op.data !== 'object') continue;
      let data = { ...op.data, [D.COLS[op.col]]: op.col === 'securities' ? id : isNaN(+id) ? id : +id };
      // An archived deal travels as a stub; a change made to the stub is laid over the full record, never replaces it.
      if (op.col === 'deals' && data._arch) { data = { ...(prev || {}), ...data }; delete data._arch; }
      if (op.col === 'deals' && prev && prev.stage !== data.stage) require('./archive').invalidate();
      if (JSON.stringify(prev) === JSON.stringify(data)) continue;
      D.putRecord(op.col, data, actor.id);
      hooks.push([op.col, prev, data]);
    }
    for (const [key, value] of Object.entries(kv)) {
      if (!D.KV.includes(key)) continue;
      const kfn = access.KV_WRITE[key]; if (kfn && !p[kfn]) throw err(403, 'Your access level does not include ' + fnLabel(kfn));
      let v = key === 'settings' ? cleanSettings(value) : value;
      if (key === 'settings') {
        const cur = D.kvGet('settings') || {};
        if (p.admin) v.access = access.cleanAccess(v.access);
        else {
          // Security and the access matrix are admin-only; lead routing needs that function; everything else in the
          // workspace settings needs Workspace settings, except each person's own notification and push preferences.
          if (!p.workspace) v = { ...cur, notifyPrefs: v.notifyPrefs, push: v.push };
          v.security = cur.security; v.access = cur.access; if (!p.routing) v.leadRouting = cur.leadRouting;
        }
      }
      if (JSON.stringify(D.kvGet(key)) !== JSON.stringify(v)) D.kvSet(key, v);
    }
    for (const op of ops) if (op && op.del && D.COLS[op.col]) D.audit(actor.id, actor.ip, 'record.delete', op.col + '/' + op.id, '');
  })();
  D.users.seen(actor.id);
  // Fire notification hooks after commit, without blocking the response.
  (async () => { for (const [col, prev, next] of hooks) await notify.onRecordChange(actor.id, col, prev, next); })().catch((e) => console.error('[hooks]', e.message));
  // A lead created by hand in the CRM never passes through the webhook path, so auto-enrol it here.
  // Calendar: mirror CRM-side event changes to Outlook (lib/calendar.js), after the response.
  (async () => { for (const [col, prev, next] of hooks) if (col === 'events') await require('./calendar').push(prev, next, actor.id); })().catch((e) => console.error('[calendar]', e.message));
  for (const [col, prev, next] of hooks) if (col === 'deals' && !prev && next && next.stage === 'new') {
    if (!next.owner) { try { const o = require('./leads').pickOwner(D.kvGet('settings') || {}, next); if (o) { next.owner = o; D.putRecord('deals', next, 'system'); notify.notify('lead', [o], { title: `New lead · ${next.practice || next.contact || ''}`, body: 'Assigned to you by the routing rules', url: '#/deal/' + next.id, kind: 'lead', id: next.id }).catch(() => {}); } } catch (e) { console.error('[routing]', e.message); } }
    try { require('./nurture').autoEnrol(next); } catch (e) { console.error('[nurture] auto-enrol skipped:', e.message); }
  }
  return pull(base, actor);
}
function pull(since, actor) {
  const out = D.changesSince(since);
  const scope = actor ? scopeFor(actor) : null;
  const p = actor ? perms(actor) : null;
  if (p || scope) out.records = out.records.filter((r) => (!p || sectionOn(p, r.col)) && (!scope || r.data === null || visible(scope, r.col, r.data)));
  out.records = require('./archive').shapeRecords(out.records);
  if (p && !p.research && out.kv && out.kv.watchlist) delete out.kv.watchlist;
  if (out.kv.settings) out.kv.settings = SERVER_SETTINGS(out.kv.settings);
  if (actor) D.users.seen(actor.id);
  return { rev: D.rev(), ...out, users: D.users.publicAll(), maxIds: D.maxIds() };
}
module.exports = { perms, access, bootstrap, applySync, pull, features, SERVER_SETTINGS, scopeFor, visible, filterState, securityPolicy, mfaRequiredFor };
