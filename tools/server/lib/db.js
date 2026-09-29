// Runs, their progress events, the documents they produced and an audit trail, in SQLite (node:sqlite).
// Free text that can hold client information (inputs, summaries, progress lines, comments) is sealed with the vault.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import * as vault from './vault.js';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
fs.mkdirSync(DATA_DIR, { recursive: true });
export const RUNS_DIR = path.join(DATA_DIR, 'runs');
export const DB_PATH = path.join(DATA_DIR, 'tools.db');
export const db = new DatabaseSync(DB_PATH);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS runs(
  id TEXT PRIMARY KEY, tool TEXT NOT NULL, status TEXT NOT NULL, client_id TEXT, client_name TEXT,
  created_by TEXT NOT NULL, created_by_name TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
  inputs TEXT, summary TEXT, error TEXT, cost_usd REAL, session_id TEXT);
CREATE INDEX IF NOT EXISTS runs_client ON runs(client_id, created_at);
CREATE TABLE IF NOT EXISTS run_events(id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, kind TEXT NOT NULL, message TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS run_events_run ON run_events(run_id, id);
CREATE TABLE IF NOT EXISTS documents(
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, client_id TEXT, filename TEXT NOT NULL, path TEXT NOT NULL,
  mime TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, sealed INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL,
  decided_by TEXT, decided_by_name TEXT, decided_at TEXT, comment TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profiles(
  id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, version INTEGER NOT NULL, run_id TEXT NOT NULL REFERENCES runs(id),
  document_id TEXT NOT NULL, data TEXT NOT NULL, as_at TEXT, confirmed_by TEXT NOT NULL, confirmed_by_name TEXT, confirmed_at TEXT NOT NULL,
  UNIQUE(client_id, version));
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, who TEXT, ip TEXT, action TEXT NOT NULL, target TEXT, detail TEXT);`);

export const now = () => new Date().toISOString();
const S = vault.seal, O = vault.open;

function runRow(r) {
  if (!r) return null;
  return {
    id: r.id, tool: r.tool, status: r.status, clientId: r.client_id, clientName: O(r.client_name), createdBy: r.created_by, createdByName: r.created_by_name,
    createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at, inputs: JSON.parse(O(r.inputs) || '{}'), summary: O(r.summary), error: O(r.error),
    costUsd: r.cost_usd,
  };
}
function docRow(d) {
  return { id: d.id, runId: d.run_id, clientId: d.client_id, filename: O(d.filename), mime: d.mime, size: d.size, status: d.status, decidedByName: d.decided_by_name, decidedAt: d.decided_at, comment: O(d.comment), createdAt: d.created_at, path: d.path, sealed: !!d.sealed };
}

export const runs = {
  insert(r) {
    db.prepare('INSERT INTO runs(id,tool,status,client_id,client_name,created_by,created_by_name,created_at,inputs) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(r.id, r.tool, 'queued', r.clientId || null, S(r.clientName || null), r.createdBy, r.createdByName || null, now(), S(JSON.stringify(r.inputs || {})));
  },
  get: (id) => runRow(db.prepare('SELECT * FROM runs WHERE id=?').get(id)),
  list({ clientId, createdBy, limit = 100 } = {}) {
    const where = []; const args = [];
    if (clientId) { where.push('client_id=?'); args.push(clientId); }
    if (createdBy) { where.push('created_by=?'); args.push(createdBy); }
    return db.prepare(`SELECT * FROM runs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`).all(...args, limit).map(runRow);
  },
  byStatus: (status) => db.prepare('SELECT id FROM runs WHERE status=? ORDER BY created_at').all(status).map((r) => r.id),
  update(id, fields) {
    const map = { status: 'status', startedAt: 'started_at', finishedAt: 'finished_at', summary: 'summary', error: 'error', costUsd: 'cost_usd', sessionId: 'session_id' };
    const sealed = new Set(['summary', 'error']);
    const keys = Object.keys(fields).filter((k) => k in map); if (!keys.length) return;
    db.prepare(`UPDATE runs SET ${keys.map((k) => map[k] + '=?').join(',')} WHERE id=?`).run(...keys.map((k) => (sealed.has(k) ? S(fields[k]) : fields[k] ?? null)), id);
  },
};

export const events = {
  add(runId, kind, message) {
    const at = now(); const r = db.prepare('INSERT INTO run_events(run_id,kind,message,at) VALUES(?,?,?,?)').run(runId, kind, S(String(message).slice(0, 4000)), at);
    return { id: Number(r.lastInsertRowid), runId, kind, message: String(message).slice(0, 4000), at };
  },
  since: (runId, afterId = 0) => db.prepare('SELECT * FROM run_events WHERE run_id=? AND id>? ORDER BY id').all(runId, afterId).map((e) => ({ id: e.id, runId: e.run_id, kind: e.kind, message: O(e.message), at: e.at })),
};

export const documents = {
  insert(d) {
    db.prepare('INSERT INTO documents(id,run_id,client_id,filename,path,mime,size,sha256,sealed,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(d.id, d.runId, d.clientId || null, S(d.filename), d.path, d.mime, d.size, d.sha256, d.sealed ? 1 : 0, d.status, now());
  },
  get: (id) => { const d = db.prepare('SELECT * FROM documents WHERE id=?').get(id); return d ? docRow(d) : null; },
  forRun: (runId) => db.prepare('SELECT * FROM documents WHERE run_id=? ORDER BY created_at, id').all(runId).map(docRow),
  decide(id, { status, by, byName, comment }) {
    db.prepare('UPDATE documents SET status=?, decided_by=?, decided_by_name=?, decided_at=?, comment=? WHERE id=?').run(status, by, byName, now(), S(comment || null), id);
  },
};

// Confirmed client profiles, one row per version. The data is sealed; the newest version is the client's current profile.
function profileRow(r, withData) {
  if (!r) return null;
  const out = { id: r.id, clientId: r.client_id, version: r.version, runId: r.run_id, documentId: r.document_id, asAt: r.as_at, confirmedByName: r.confirmed_by_name, confirmedAt: r.confirmed_at };
  if (withData) out.data = JSON.parse(O(r.data));
  return out;
}
export const profiles = {
  add({ clientId, runId, documentId, data, by, byName }) {
    const next = (db.prepare('SELECT MAX(version) AS v FROM profiles WHERE client_id=?').get(clientId).v || 0) + 1;
    db.prepare('INSERT INTO profiles(client_id,version,run_id,document_id,data,as_at,confirmed_by,confirmed_by_name,confirmed_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(clientId, next, runId, documentId, S(JSON.stringify(data)), data.as_at || null, by, byName || null, now());
    return next;
  },
  latest: (clientId, withData = true) => profileRow(db.prepare('SELECT * FROM profiles WHERE client_id=? ORDER BY version DESC LIMIT 1').get(clientId), withData),
  forRun: (runId) => profileRow(db.prepare('SELECT * FROM profiles WHERE run_id=? ORDER BY version DESC LIMIT 1').get(runId), false),
};

export function audit(who, ip, action, target, detail) {
  db.prepare('INSERT INTO audit(at,who,ip,action,target,detail) VALUES(?,?,?,?,?,?)').run(now(), who || null, ip || null, action, target || null, S(detail ? JSON.stringify(detail) : null));
}
