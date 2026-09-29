// End to end against the real CRM: boot crm/server with two clients and a year of records, boot the tools service
// beside it with the demo agent (AGENT_FAKE=1), and drive both over HTTP the way the browser does.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const CRM_PORT = 3991, TOOLS_PORT = 3992;
const CRM_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-crm-')), TOOLS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-data-'));
const KEY = 'v1:' + crypto.randomBytes(32).toString('base64');
const procs = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function boot(cwd, file, env, marker) {
  const p = spawn(process.execPath, [file], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(p); let log = ''; p.stdout.on('data', (c) => (log += c)); p.stderr.on('data', (c) => (log += c));
  return (async () => { for (let i = 0; i < 80 && !marker.test(log); i++) await sleep(100); if (!marker.test(log)) throw new Error('did not boot:\n' + log); return () => log; })();
}
const jar = {};
async function crmLogin(email) {
  const r = await fetch(`http://127.0.0.1:${CRM_PORT}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'brightday' }, body: JSON.stringify({ email, password: 'pw-1234567890' }) });
  assert.equal(r.status, 200, 'CRM login ' + email);
  jar[email] = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}
const tools = (p, { as, method, body, headers = {} } = {}) => fetch(`http://127.0.0.1:${TOOLS_PORT}/tools/${p}`, { method: method || (body ? 'POST' : 'GET'), headers: { ...(as ? { cookie: jar[as] } : {}), 'x-requested-with': 'brightday', ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...headers }, body: body && !(body instanceof FormData) ? JSON.stringify(body) : body });
async function until(fn, ms = 8000) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out'); await sleep(100); } }

before(async () => {
  // Seed the CRM: an adviser, a paraplanner, a Basic user; two clients, each with email, a meeting, a task and a note.
  process.env.DATA_DIR = CRM_DATA; process.env.ALLOW_UNENCRYPTED = '1';
  const require = createRequire(import.meta.url);
  const D = require(ROOT + '/crm/server/lib/db'); const auth = require(ROOT + '/crm/server/lib/auth');
  for (const [id, email, name, role] of [['u1', 'adviser@x.com', 'Alex Morgan', 'Client manager'], ['u2', 'para@x.com', 'Sam Rivera', 'Paraplanner'], ['u3', 'basic@x.com', 'Jordan Lee', 'Basic']]) D.users.insert({ id, email, name, role, status: 'Active', color: '#F50D74', pw_hash: auth.hashPassword('pw-1234567890') });
  D.kvSet('settings', { notifyPrefs: { events: [], quietFrom: '', quietTo: '' }, security: { mfaRequired: 'none' } });
  D.putRecord('clients', { id: 1, name: 'Harper Nguyen', contact: 'Harper Nguyen', email: 'harper@example.test', owner: 'u1', status: 'Active', deals: [], notes: 'Retiring in March.' });
  D.putRecord('clients', { id: 2, name: 'Wilson SMSF', contact: 'Pat Wilson', email: 'pat@wilson.test', owner: 'u2', status: 'Active', deals: [] });
  D.putRecord('threads', { id: 1, client: 1, folder: 'inbox', from: 'Harper Nguyen', addr: 'harper@example.test', subject: 'TTR question', at: '2026-03-02T09:00', msgs: [{ from: 'Harper Nguyen', at: '2026-03-02T09:00', body: 'Can I keep salary sacrificing once the TTR pension starts?' }] });
  D.putRecord('threads', { id: 2, folder: 'inbox', from: 'Pat Wilson', addr: 'pat@wilson.test', subject: 'Bank statements', at: '2026-03-03T09:00', msgs: [{ from: 'Pat Wilson', at: '2026-03-03T09:00', body: 'Statements attached.' }] });
  D.putRecord('events', { id: 1, client: 1, title: 'Review meeting', kind: 'Review', start: '2026-04-10T10:00', end: '2026-04-10T11:00', who: ['u1'] });
  D.putRecord('tasks', { id: 1, client: 1, title: 'Send OFA', due: '2026-05-01', who: ['u1'], done: false });
  D.putRecord('activity', { id: 1, client: 1, type: 'note', who: 'u1', text: 'Phone call about contributions', at: '2026-02-20T15:00' });
  D.db.close();
  await boot(ROOT + '/crm/server', 'index.js', { DATA_DIR: CRM_DATA, PORT: String(CRM_PORT), ALLOW_UNENCRYPTED: '1', NODE_ENV: 'test' }, /\[boot\] /);
  await boot(ROOT + '/tools', 'server/index.js', { DATA_DIR: TOOLS_DATA, PORT: String(TOOLS_PORT), CRM_URL: `http://127.0.0.1:${CRM_PORT}`, AGENT_FAKE: '1', DATA_KEYS: KEY, NODE_ENV: 'test' }, /\[boot\] /);
  for (const e of ['adviser@x.com', 'para@x.com', 'basic@x.com']) await crmLogin(e);
});
after(() => { for (const p of procs) p.kill(); fs.rmSync(CRM_DATA, { recursive: true, force: true }); fs.rmSync(TOOLS_DATA, { recursive: true, force: true }); });

test('the page is served under /tools/ and /tools redirects there', async () => {
  const page = await fetch(`http://127.0.0.1:${TOOLS_PORT}/tools/`);
  assert.equal(page.status, 200); assert.match(await page.text(), /Advice tools/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const bare = await fetch(`http://127.0.0.1:${TOOLS_PORT}/tools`, { redirect: 'manual' });
  assert.equal(bare.status, 302); assert.equal(bare.headers.get('location'), '/tools/');
});

test('sign-in comes from the CRM session, and access follows the CRM access level', async () => {
  assert.equal((await tools('api/me')).status, 401);
  assert.equal((await tools('api/me', { headers: { cookie: 'brightday_session=forged' } })).status, 401);
  const me = await (await tools('api/me', { as: 'adviser@x.com' })).json();
  assert.equal(me.user.email, 'adviser@x.com'); assert.equal(me.canApprove, true);
  const para = await (await tools('api/me', { as: 'para@x.com' })).json();
  assert.equal(para.canApprove, false, 'paraplanners prepare, they do not sign off');
  assert.equal((await tools('api/me', { as: 'basic@x.com' })).status, 403);
});

test('the client list is the CRM list as this person sees it', async () => {
  const { clients } = await (await tools('api/clients', { as: 'adviser@x.com' })).json();
  assert.deepEqual(clients.map((c) => c.name), ['Harper Nguyen'], 'a Client manager only sees their own clients');
  const para = await (await tools('api/clients', { as: 'para@x.com' })).json();
  assert.deepEqual(para.clients.map((c) => c.name).sort(), ['Harper Nguyen', 'Wilson SMSF']);
});

test('a state-changing request needs the X-Requested-With header', async () => {
  const fd = new FormData(); fd.append('tool', 'fee-comparison'); fd.append('alternatives', 'HUB24');
  const r = await fetch(`http://127.0.0.1:${TOOLS_PORT}/tools/api/runs`, { method: 'POST', headers: { cookie: jar['adviser@x.com'] }, body: fd });
  assert.equal(r.status, 403);
});

test('an annual review runs with the client context, seals its files, and waits for an adviser', async () => {
  const fd = new FormData();
  fd.append('tool', 'annual-review'); fd.append('clientId', '1'); fd.append('periodStart', '2025-07-01'); fd.append('periodEnd', '2026-06-30'); fd.append('ongoingFee', '$5,500 a year');
  fd.append('platformReports', new Blob(['Holding,Value\nVAS,100000\n']), '../../etc/Performance report.csv');
  const r = await tools('api/runs', { as: 'para@x.com', body: fd });
  assert.equal(r.status, 201, await r.clone().text());
  const run = await r.json();
  const done = await until(async () => { const x = await (await tools('api/runs/' + run.id, { as: 'para@x.com' })).json(); return x.status === 'review' && x; });
  assert.equal(done.documents.length, 1); assert.equal(done.documents[0].status, 'draft');
  assert.deepEqual(done.inputs.files.platformReports, ['Performance report.csv'], 'upload names are stripped of paths');

  // Context written from the CRM: this client's email, meeting, task and note; not the other client's.
  const dir = path.join(TOOLS_DATA, 'runs', run.id);
  const files = fs.readdirSync(path.join(dir, 'context')).sort();
  assert.deepEqual(files, ['client.json.sealed', 'emails.md.sealed', 'file-notes.md.sealed', 'meetings.json.sealed', 'tasks.json.sealed']);
  process.env.DATA_KEYS = KEY; const vault = await import('../server/lib/vault.js');
  const emails = vault.openBuf(fs.readFileSync(path.join(dir, 'context', 'emails.md.sealed')), true).toString();
  assert.match(emails, /salary sacrificing/); assert.doesNotMatch(emails, /Statements attached/);
  assert.match(vault.openBuf(fs.readFileSync(path.join(dir, 'context', 'file-notes.md.sealed')), true).toString(), /contributions/);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'context', 'emails.md.sealed')).toString('latin1'), /salary/, 'context is encrypted at rest');

  // Download decrypts; the paraplanner cannot approve; the adviser can, which completes the run.
  const doc = done.documents[0];
  const dl = await tools('api/documents/' + doc.id, { as: 'para@x.com' });
  assert.equal(dl.status, 200); assert.match(await dl.text(), /Annual review \(demo draft\)/);
  assert.equal((await tools(`api/documents/${doc.id}/decision`, { as: 'para@x.com', body: { decision: 'approved' } })).status, 403);
  assert.equal((await tools(`api/documents/${doc.id}/decision`, { as: 'adviser@x.com', body: { decision: 'rejected' } })).status, 400, 'sending back needs a reason');
  const ok = await (await tools(`api/documents/${doc.id}/decision`, { as: 'adviser@x.com', body: { decision: 'approved' } })).json();
  assert.equal(ok.status, 'done'); assert.equal(ok.documents[0].status, 'approved'); assert.equal(ok.documents[0].decidedByName, 'Alex Morgan');
});

test('the progress stream replays what happened', async () => {
  const fd = new FormData(); fd.append('tool', 'fee-comparison'); fd.append('alternatives', 'HUB24 Choice');
  const run = await (await tools('api/runs', { as: 'adviser@x.com', body: fd })).json();
  const ctl = new AbortController(); const res = await tools(`api/runs/${run.id}/events`, { as: 'adviser@x.com', headers: { accept: 'text/event-stream' } });
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader(); let text = '';
  await until(async () => { const { value } = await reader.read(); text += new TextDecoder().decode(value); return /"kind":"end"/.test(text); });
  ctl.abort(); reader.cancel();
  assert.match(text, /Queued/); assert.match(text, /Loading the fee-comparison skill/); assert.match(text, /Finished with 1 document/);
});

test('people only see runs they may see, and the form is validated', async () => {
  // Sam (paraplanner) starts a run for Wilson SMSF, a client Alex does not have.
  const fd = new FormData(); fd.append('tool', 'fee-comparison'); fd.append('clientId', '2'); fd.append('alternatives', 'HUB24');
  const wilson = await (await tools('api/runs', { as: 'para@x.com', body: fd })).json();
  const mine = await (await tools('api/runs', { as: 'adviser@x.com' })).json();
  assert.ok(mine.runs.some((r) => r.createdByName === 'Sam Rivera' && r.clientName === 'Harper Nguyen'), "a Client manager sees runs for their own clients, whoever started them");
  assert.ok(!mine.runs.some((r) => r.id === wilson.id), 'but not runs for clients outside their list');
  assert.equal((await tools('api/runs/' + wilson.id, { as: 'adviser@x.com' })).status, 404);
  const all = await (await tools('api/runs', { as: 'para@x.com' })).json();
  assert.ok(all.runs.some((r) => r.id === wilson.id) && all.runs.some((r) => r.createdByName === 'Alex Morgan'), 'a paraplanner with "see everyone" sees the practice');

  const missing = new FormData(); missing.append('tool', 'tax-optimisation'); missing.append('clientId', '1');
  const r1 = await tools('api/runs', { as: 'adviser@x.com', body: missing });
  assert.equal(r1.status, 400); assert.match((await r1.json()).error, /CGT reports is required/);
  const notMine = new FormData(); notMine.append('tool', 'fee-comparison'); notMine.append('clientId', '2'); notMine.append('alternatives', 'x');
  const r2 = await tools('api/runs', { as: 'adviser@x.com', body: notMine });
  assert.equal(r2.status, 400, 'a client outside your list cannot be used'); assert.match((await r2.json()).error, /not in your client list/);
});
