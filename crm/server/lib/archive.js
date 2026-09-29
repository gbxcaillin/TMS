'use strict';
// Archive: deals in a closed stage (won, lost) for longer than settings.archiveDays (default 90, 0 = off) reach the
// browser as small stubs with the fields lists, cards, search and reports need. Their heavy history (timeline,
// changelog, email conversation, files, calls) stays on the server until someone opens the deal, which fetches it
// (GET /archive/deal/:id). Keeps sign-in, sync and phones fast however large the book grows. Nothing is deleted.
const D = require('./db');

const STUB = ['id', 'practice', 'contact', 'email', 'phone', 'stage', 'value', 'source', 'service', 'segment', 'created', 'close', 'owner', 'client', 'priority', 'aiScore', 'lostReason', 'city', 'licensee'];
const DEPENDENT = { activity: (r) => r.deal, threads: (r) => r.deal, files: (r) => r.deal, calls: (r) => r.deal, changes: (r) => (r.entity === 'deal' ? r.ref : null) };
function days() { const n = (D.kvGet('settings') || {}).archiveDays; return n === 0 || n === '0' ? 0 : Number(n) || 90; }

let cache = { at: 0, key: '', set: new Set() };
// Ids of archived deals; recomputed at most once a minute (and when the setting changes).
function ids() {
  const n = days(); const key = String(n);
  if (Date.now() - cache.at < 60e3 && cache.key === key) return cache.set;
  const set = new Set();
  if (n) {
    const closed = new Set((D.kvGet('stages') || []).filter((s) => s.closed).map((s) => s.id));
    const cutoff = D.localIso(new Date(Date.now() - n * 864e5)).slice(0, 10);
    const deals = D.listCol('deals').filter((d) => closed.has(d.stage));
    if (deals.length) {
      const stageAt = {}; for (const c of D.listCol('changes')) if (c.entity === 'deal' && c.field === 'Stage' && (!stageAt[c.ref] || c.at > stageAt[c.ref])) stageAt[c.ref] = c.at;
      for (const d of deals) { const when = String(stageAt[d.id] || d.close || d.created || '').slice(0, 10); if (when && when < cutoff) set.add(d.id); }
    }
  }
  cache = { at: Date.now(), key, set }; return set;
}
function invalidate() { cache.at = 0; }
const stub = (d) => { const s = { _arch: true }; for (const k of STUB) if (d[k] !== undefined) s[k] = d[k]; return s; };
const archivedRef = (col, r, set) => { const f = DEPENDENT[col]; const id = f && r ? f(r) : null; return id != null && set.has(Number(id)); };

// Bootstrap: stub archived deals and leave their history out.
function shapeState(state) {
  const set = ids(); if (!set.size) return state;
  if (state.deals) state.deals = state.deals.map((d) => (set.has(d.id) ? stub(d) : d));
  for (const col of Object.keys(DEPENDENT)) if (state[col]) state[col] = state[col].filter((r) => !archivedRef(col, r, set));
  return state;
}
// Pull: the same for the change feed.
function shapeRecords(records) {
  const set = ids(); if (!set.size) return records;
  const out = [];
  for (const r of records) {
    if (r.col === 'deals' && r.data && set.has(r.data.id)) { out.push({ ...r, data: stub(r.data) }); continue; }
    if (r.data && archivedRef(r.col, r.data, set)) continue;
    out.push(r);
  }
  return out;
}
// Everything about one archived deal, for the deal page.
function dealBundle(id) {
  id = Number(id); const d = D.getRecord('deals', id); if (!d) return null;
  const out = { deals: [d] };
  for (const col of Object.keys(DEPENDENT)) out[col] = D.listCol(col).filter((r) => Number(DEPENDENT[col](r)) === id);
  return out;
}
module.exports = { ids, invalidate, shapeState, shapeRecords, dealBundle, stub, days, STUB };
