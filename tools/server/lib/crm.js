// The CRM is the source of truth for who is signed in and for client data. The browser's CRM session cookie comes
// with every request to /tools/ (same host), and is forwarded to the CRM on the internal network. Nothing here keeps
// its own login.
import crypto from 'node:crypto';

const CRM = (process.env.CRM_URL || 'http://localhost:3000').replace(/\/$/, '');
const CSRF = process.env.CRM_CSRF_HEADER || 'brightday'; // the CRM's X-Requested-With value (its brand slug)
const cache = new Map(); // sha256(cookie) -> { at, value }
const TTL = 30e3;

export class CrmError extends Error { constructor(status, message) { super(message); this.status = status; } }

async function call(path, cookie, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(CRM + '/api/v1' + path, {
      method,
      headers: { cookie: cookie || '', 'x-requested-with': CSRF, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20e3),
    });
  } catch (e) { throw new CrmError(502, 'The CRM did not answer: ' + e.message); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new CrmError(res.status, j.error || `CRM ${res.status}`);
  return j;
}

/** { user, perms } for the session on this request, or null when signed out. Cached briefly per cookie. */
export async function whoami(cookie) {
  if (!cookie) return null;
  const key = crypto.createHash('sha256').update(cookie).digest('hex');
  const hit = cache.get(key); if (hit && Date.now() - hit.at < TTL) return hit.value;
  let value = null;
  try { value = await call('/auth/me', cookie); } catch (e) { if (e.status !== 401 && e.status !== 403) throw e; }
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 500) for (const [k, v] of cache) if (Date.now() - v.at > TTL) cache.delete(k);
  return value;
}

/** The workspace as this user sees it (their access level and record scope apply). */
export async function workspace(cookie) {
  const b = await call('/bootstrap', cookie);
  return b.state || {};
}

const lower = (s) => String(s || '').toLowerCase().trim();

const visibleCache = new Map();
/** Ids of the clients this session can see in the CRM (cached briefly), for deciding which runs they may open. */
export async function visibleClientIds(cookie) {
  const key = crypto.createHash('sha256').update(cookie || '').digest('hex');
  const hit = visibleCache.get(key); if (hit && Date.now() - hit.at < TTL) return hit.ids;
  const ids = new Set(((await workspace(cookie)).clients || []).map((c) => String(c.id)));
  visibleCache.set(key, { at: Date.now(), ids });
  if (visibleCache.size > 500) for (const [k, v] of visibleCache) if (Date.now() - v.at > TTL) visibleCache.delete(k);
  return ids;
}

/** Clients this user can see, for the picker. */
export function clientList(state) {
  return (state.clients || []).map((c) => ({ id: String(c.id), name: c.name, contact: c.contact || '', email: c.email || '', status: c.status || '' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Everything in the workspace that belongs to one client: linked directly, through one of its deals, or by email. */
export function clientRecords(state, clientId) {
  const client = (state.clients || []).find((c) => String(c.id) === String(clientId));
  if (!client) return null;
  const deals = new Set((client.deals || []).map(String));
  const emails = new Set([client.email, ...(client.emails || [])].filter(Boolean).map(lower));
  const mine = (r) => String(r.client ?? '') === String(client.id) || (r.deal != null && deals.has(String(r.deal)));
  const users = Object.fromEntries((state.users || []).map((u) => [u.id, u.name]));
  return {
    client,
    deals: (state.deals || []).filter((d) => deals.has(String(d.id))),
    threads: (state.threads || []).filter((t) => mine(t) || emails.has(lower(t.addr))),
    events: (state.events || []).filter(mine),
    tasks: (state.tasks || []).filter(mine),
    activity: (state.activity || []).filter(mine),
    files: (state.files || []).filter(mine),
    users,
  };
}
