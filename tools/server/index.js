// Brightday advice tools: a small service mounted beside the CRM at /tools/ on the same host. It signs people in
// through the CRM's session, reads client records from the CRM as that person, runs the practice's skills with the
// Claude Agent SDK, and keeps the runs, their progress and the documents they produce.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { TOOLS, TOOL } from './lib/registry.js';
import * as store from './lib/db.js';
import * as vault from './lib/vault.js';
import * as crm from './lib/crm.js';
import { writeContext } from './lib/context.js';
import * as runner from './lib/runner.js';

const PORT = Number(process.env.PORT || 3100);
const BASE = '/' + (process.env.BASE_PATH || 'tools').replace(/^\/|\/$/g, '');
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_MB || 100) * 1024 * 1024;
const CSRF = process.env.CRM_CSRF_HEADER || 'brightday';
// Who may approve compliance documents (SOA/ROA, annual review, OFA). Paraplanners prepare; advisers sign off.
const APPROVERS = (process.env.APPROVER_ROLES || 'Admin,Manager,Client manager').split(',').map((s) => s.trim());
const PAGE = fs.readFileSync(new URL('../public/index.html', import.meta.url));

if (!vault.enabled()) {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_UNENCRYPTED !== '1') { console.error('[vault] DATA_KEYS is not set (use the CRM\'s key). Refusing to start.'); process.exit(1); }
  console.warn('[vault] WARNING: running without encryption at rest');
}

const CSP = ["default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com data:", "img-src 'self' data:", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'"].join('; ');
const HEADERS = { 'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'permissions-policy': 'camera=(), microphone=(), geolocation=()' };
if (process.env.NODE_ENV === 'production') HEADERS['strict-transport-security'] = 'max-age=31536000; includeSubDomains';

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => new HttpError(status, message);
function json(res, status, body) { const b = Buffer.from(JSON.stringify(body)); res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': b.length, 'cache-control': 'no-store' }); res.end(b); }
const ipOf = (req) => String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

async function readJson(req) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > 64 * 1024) throw fail(413, 'Body too large'); chunks.push(c); }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}; } catch { throw fail(400, 'Invalid JSON'); }
}

/** Signed-in user with the tools permission, from the CRM session on this request. */
async function person(req) {
  const me = await crm.whoami(req.headers.cookie);
  if (!me) throw fail(401, 'Sign in to the portal first');
  if (me.mfaSetup) throw fail(403, 'Finish setting up two-factor authentication in the portal first');
  if (!me.perms || !me.perms.tools) throw fail(403, 'Your access level does not include the advice tools');
  if (req.method !== 'GET' && req.headers['x-requested-with'] !== CSRF) throw fail(403, 'Missing X-Requested-With header');
  return { ...me.user, perms: me.perms, ip: ipOf(req) };
}
// A run is visible to whoever started it, to anyone who sees every record, and to anyone who has its client in
// their CRM client list (so the client's adviser can review a run their paraplanner started).
const seesAll = (u) => !!(u.perms.allRecords || u.perms.admin);
async function canSee(req, u, run) {
  if (seesAll(u) || run.createdBy === u.id) return true;
  return !!run.clientId && (await crm.visibleClientIds(req.headers.cookie)).has(String(run.clientId));
}
const canApprove = (u) => APPROVERS.includes(u.role);
const safeName = (name) => (path.basename(String(name || 'file')).normalize('NFKC').replace(/[^\w.\- ()]+/g, '_').replace(/^\.+/, '').slice(0, 150) || 'file');

function viewRun(run, u) {
  return { ...run, documents: store.documents.forRun(run.id).map(({ path: _p, sealed: _s, ...d }) => d), canApprove: canApprove(u), tool: run.tool };
}

const routes = [];
const on = (method, pattern, handler) => { const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$'); routes.push({ method, re, keys, handler }); };

on('GET', '/api/health', async (req, res) => json(res, 200, { ok: true, ...runner.info(), encryption: vault.enabled() }));
on('GET', '/api/me', async (req, res) => { const u = await person(req); json(res, 200, { user: u, canApprove: canApprove(u) }); });
on('GET', '/api/tools', async (req, res) => { await person(req); json(res, 200, { tools: TOOLS, skills: runner.info().skills, demo: runner.info().fake }); });
on('GET', '/api/clients', async (req, res) => { await person(req); json(res, 200, { clients: crm.clientList(await crm.workspace(req.headers.cookie)) }); });

on('POST', '/api/runs', async (req, res) => {
  const u = await person(req);
  if (!/^multipart\/form-data/.test(req.headers['content-type'] || '')) throw fail(415, 'Send the form as multipart/form-data');
  if (Number(req.headers['content-length'] || 0) > MAX_UPLOAD) throw fail(413, `Uploads are limited to ${MAX_UPLOAD / 1048576} MB in total`);
  let size = 0; const limited = Readable.toWeb(req).pipeThrough(new TransformStream({ transform(chunk, c) { size += chunk.byteLength; if (size > MAX_UPLOAD) c.error(fail(413, 'Upload too large')); else c.enqueue(chunk); } }));
  const form = await new Request('http://tools.local/', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body: limited, duplex: 'half' }).formData();
  const tool = TOOL[String(form.get('tool') || '')]; if (!tool) throw fail(400, 'Unknown tool');

  const inputs = {}; const files = {};
  for (const f of tool.fields) {
    if (f.kind === 'files') { const list = form.getAll(f.key).filter((x) => typeof x === 'object' && x.size > 0); if (list.length) files[f.key] = list; }
    else { const v = String(form.get(f.key) ?? '').trim(); if (v) inputs[f.key] = v.slice(0, 20000); }
    const present = f.kind === 'files' ? !!files[f.key] : inputs[f.key] !== undefined;
    if (f.required && !present) throw fail(400, f.label + ' is required');
    if (f.kind === 'select' && present && !f.options.some((o) => o.value === inputs[f.key])) throw fail(400, 'Choose a valid ' + f.label.toLowerCase());
    if (f.kind === 'date' && present && !/^\d{4}-\d{2}-\d{2}$/.test(inputs[f.key])) throw fail(400, f.label + ' must be a date');
  }

  // Client records are read now, as this person, so the run only ever sees what they can see.
  let recs = null;
  if (inputs.clientId) {
    recs = crm.clientRecords(await crm.workspace(req.headers.cookie), inputs.clientId);
    if (!recs) throw fail(400, 'That client is not in your client list');
  }

  const id = crypto.randomUUID();
  const runDir = path.join(store.RUNS_DIR, id);
  const saved = {};
  for (const [key, list] of Object.entries(files)) {
    fs.mkdirSync(path.join(runDir, 'inputs', key), { recursive: true });
    saved[key] = [];
    for (const file of list) { const name = safeName(file.name); fs.writeFileSync(path.join(runDir, 'inputs', key, name), Buffer.from(await file.arrayBuffer())); saved[key].push(name); }
  }
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({ tool: tool.id, inputs: { ...inputs, client: recs ? recs.client.name : undefined } }, null, 2));
  writeContext(runDir, tool, recs, inputs);

  store.runs.insert({ id, tool: tool.id, clientId: inputs.clientId, clientName: recs?.client.name, createdBy: u.id, createdByName: u.name, inputs: { ...inputs, files: saved } });
  store.events.add(id, 'status', 'Queued');
  store.audit(u.id, u.ip, 'run.start', id, { tool: tool.id, client: inputs.clientId || null });
  runner.enqueue(id);
  json(res, 201, viewRun(store.runs.get(id), u));
});

on('GET', '/api/runs', async (req, res, q) => {
  const u = await person(req);
  let list = store.runs.list({ clientId: q.get('client') || undefined });
  if (!seesAll(u)) { const mine = await crm.visibleClientIds(req.headers.cookie); list = list.filter((r) => r.createdBy === u.id || (r.clientId && mine.has(String(r.clientId)))); }
  json(res, 200, { runs: list.map(({ inputs: _i, summary: _s, ...r }) => r) });
});
async function ownRun(req, u, id) { const run = store.runs.get(id); if (!run || !(await canSee(req, u, run))) throw fail(404, 'Run not found'); return run; }
on('GET', '/api/runs/:id', async (req, res, q, p) => { const u = await person(req); json(res, 200, viewRun(await ownRun(req, u, p.id), u)); });
on('POST', '/api/runs/:id/cancel', async (req, res, q, p) => {
  const u = await person(req); await ownRun(req, u, p.id);
  if (!runner.cancel(p.id)) throw fail(409, 'This run has already finished');
  store.audit(u.id, u.ip, 'run.cancel', p.id); json(res, 200, { ok: true });
});
on('GET', '/api/runs/:id/events', async (req, res, q, p) => {
  const u = await person(req); await ownRun(req, u, p.id);
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  let last = Number(req.headers['last-event-id'] || 0) || 0;
  const send = (ev) => { if (ev.id <= last) return; last = ev.id; res.write(`id: ${ev.id}\ndata: ${JSON.stringify(ev)}\n\n`); };
  const listener = (ev) => send(ev); runner.bus.on(p.id, listener);
  store.events.since(p.id, last).forEach(send);
  const ping = setInterval(() => res.write(': ping\n\n'), 25e3);
  req.on('close', () => { clearInterval(ping); runner.bus.off(p.id, listener); });
});

on('GET', '/api/documents/:id', async (req, res, q, p) => {
  const u = await person(req);
  const d = store.documents.get(p.id); if (!d) throw fail(404, 'Document not found');
  await ownRun(req, u, d.runId);
  const file = path.resolve(store.DATA_DIR, d.path); if (!file.startsWith(store.DATA_DIR + path.sep)) throw fail(400, 'Bad path');
  const buf = vault.openBuf(fs.readFileSync(file), d.sealed);
  store.audit(u.id, u.ip, 'document.download', d.id);
  res.writeHead(200, { 'content-type': d.mime, 'content-length': buf.length, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(d.filename)}`, 'cache-control': 'no-store' });
  res.end(buf);
});
on('POST', '/api/documents/:id/decision', async (req, res, q, p) => {
  const u = await person(req);
  if (!canApprove(u)) throw fail(403, 'Only an adviser can approve or send back advice documents');
  const d = store.documents.get(p.id); if (!d) throw fail(404, 'Document not found');
  const run = await ownRun(req, u, d.runId);
  if (d.status !== 'draft') throw fail(409, 'This document is not waiting for review');
  const b = await readJson(req);
  if (!['approved', 'rejected'].includes(b.decision)) throw fail(400, 'Decision must be approved or rejected');
  if (b.decision === 'rejected' && !String(b.comment || '').trim()) throw fail(400, 'Say what needs to change');
  store.documents.decide(d.id, { status: b.decision, by: u.id, byName: u.name, comment: String(b.comment || '').slice(0, 2000) });
  store.audit(u.id, u.ip, 'document.' + b.decision, d.id, { run: run.id });
  const docs = store.documents.forRun(run.id);
  if (run.status === 'review' && docs.every((x) => x.status === 'approved')) { store.runs.update(run.id, { status: 'done', finishedAt: store.now() }); runner.bus.emit(run.id, store.events.add(run.id, 'end', 'Approved by ' + u.name)); }
  json(res, 200, viewRun(store.runs.get(run.id), u));
});

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(HEADERS)) res.setHeader(k, v);
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === BASE) { res.writeHead(302, { location: BASE + '/' }); return res.end(); }
    if (!url.pathname.startsWith(BASE + '/')) throw fail(404, 'Not found');
    const p = url.pathname.slice(BASE.length);
    if (!p.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw fail(405, 'Method not allowed');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', 'content-length': PAGE.length }); return res.end(PAGE);
    }
    for (const r of routes) {
      if (r.method !== req.method) continue; const m = r.re.exec(p); if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      return await r.handler(req, res, url.searchParams, params);
    }
    throw fail(404, 'No such endpoint');
  } catch (e) {
    const status = e.status || 500; if (status >= 500) console.error('[tools]', req.method, url.pathname, e);
    if (!res.headersSent) json(res, status, { error: status >= 500 && !(e instanceof crm.CrmError) ? 'Server error' : e.message }); else res.end();
  }
});
server.requestTimeout = 0; // uploads and event streams can be long
server.listen(PORT, '0.0.0.0', () => {
  runner.resume();
  const i = runner.info();
  console.log(`[boot] Brightday advice tools on :${PORT}${BASE}/ · db ${store.DB_PATH} · ${i.fake ? 'DEMO agent (AGENT_FAKE=1)' : 'model ' + i.model} · skills: ${i.skills.join(', ') || 'none yet (add them to agent/skills)'}`);
});
process.on('unhandledRejection', (e) => console.error('[unhandled]', e));
