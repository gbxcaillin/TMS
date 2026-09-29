// Runs advice tools one job at a time per slot (RUN_CONCURRENCY), in this process. Each run has a folder:
//   run.json  inputs/<field>/…  context/…  outputs/   (the agent's working directory)
// The agent is the Claude Agent SDK with the practice's skills loaded from agent/ as a plugin. Progress lines go to
// run_events and to anyone watching the run's event stream. When the run ends, every file in outputs/ becomes a
// document, and the whole folder is sealed with the vault key.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { TOOL } from './registry.js';
import * as store from './db.js';
import * as vault from './vault.js';

const MODEL = process.env.AGENT_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.AGENT_EFFORT || 'high';
const MAX_TURNS = Number(process.env.AGENT_MAX_TURNS || 150);
const MAX_BUDGET = Number(process.env.AGENT_MAX_BUDGET_USD || 15);
const ALLOW_WEB = process.env.AGENT_ALLOW_WEB === '1';
const FAKE = process.env.AGENT_FAKE === '1';
const PLUGIN_DIR = path.resolve(process.env.SKILLS_DIR || new URL('../../agent', import.meta.url).pathname);
const SLOTS = Math.max(1, Number(process.env.RUN_CONCURRENCY || 2));
// Skills in a plugin are named <plugin>:<skill> (e.g. brightday:annual-review).
const PLUGIN_NAME = (() => { try { return JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, '.claude-plugin', 'plugin.json'), 'utf8')).name; } catch { return ''; } })();

export const bus = new EventEmitter(); bus.setMaxListeners(200);
function emit(runId, kind, message) { const ev = store.events.add(runId, kind, message); bus.emit(runId, ev); return ev; }

const MIME = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.pdf': 'application/pdf', '.csv': 'text/csv', '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json', '.png': 'image/png',
};
export const mimeOf = (name) => MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';

const SYSTEM = `You are working inside Brightday's adviser portal, for an Australian financial advice practice.
Everything you produce is a DRAFT for a licensed adviser to review before it reaches a client.

- Work only with the files in the current directory: ./run.json (form inputs), ./inputs (files the adviser uploaded)
  and ./context (client records from the CRM).
- Save every deliverable in ./outputs with a clear file name, e.g. "Annual review - <client> - FY26.docx".
- Never invent figures. When a number is missing or unclear, leave a marked placeholder like [[CONFIRM: ...]] and list
  it in your summary.
- Nothing is sent anywhere from here: no email, no uploads. None is needed.
- Finish with a short plain-English summary for the adviser: what you produced, the key findings, and every item
  they must check or confirm.`;

function prompt(tool, contextFiles, inputFiles) {
  return [
    `Use the "${PLUGIN_NAME ? PLUGIN_NAME + ':' : ''}${tool.skill}" skill for this job: ${tool.name}.`,
    'The form inputs are in ./run.json.',
    inputFiles.length ? 'Uploaded files:\n' + inputFiles.map((f) => '- ./' + f).join('\n') : 'No files were uploaded.',
    contextFiles.length ? 'Client records from the CRM:\n' + contextFiles.map((f) => '- ./' + f).join('\n') : '',
    `Expected deliverables (save them in ./outputs): ${tool.outputs.join('; ')}.`,
  ].filter(Boolean).join('\n\n');
}

function describe(name, input = {}) {
  const base = (k) => (typeof input[k] === 'string' ? path.basename(input[k]) : '');
  switch (name) {
    case 'Read': return 'Reading ' + base('file_path');
    case 'Write': return 'Writing ' + base('file_path');
    case 'Edit': return 'Editing ' + base('file_path');
    case 'Bash': return 'Running: ' + String(input.description || input.command || '').slice(0, 160);
    case 'Glob': case 'Grep': return `Looking through files (${input.pattern || ''})`;
    case 'Skill': return 'Loading the ' + (input.skill || input.name || '') + ' skill';
    case 'WebSearch': return 'Searching the web: ' + (input.query || '');
    case 'WebFetch': return 'Reading ' + (input.url || '');
    default: return 'Using ' + name;
  }
}

const walk = (dir, base = dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))])) : []);

/** Stand-in agent for tests and demos without an API key (AGENT_FAKE=1). */
async function fakeAgent(tool, runDir, signal, onTool, onText) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const step of [['Skill', { skill: tool.skill }], ['Read', { file_path: 'run.json' }], ['Glob', { pattern: 'inputs/**/*' }]]) { if (signal.aborted) throw new Error('Cancelled'); onTool(...step); await wait(150); }
  const inputs = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
  onText(`Demo run: the ${tool.skill} skill is not being called because AGENT_FAKE=1.`);
  const name = `${tool.name} - draft.md`;
  onTool('Write', { file_path: 'outputs/' + name });
  fs.writeFileSync(path.join(runDir, 'outputs', name), `# ${tool.name} (demo draft)\n\nInputs:\n\n\`\`\`json\n${JSON.stringify(inputs, null, 2)}\n\`\`\`\n\n[[CONFIRM: this is placeholder output]]\n`);
  return { summary: `Demo draft written (${name}). Set ANTHROPIC_API_KEY and unset AGENT_FAKE to run the real skill.\n\nCheck: [[CONFIRM: placeholder output]]`, cost: 0, sessionId: null };
}

async function realAgent(tool, runDir, contextFiles, inputFiles, signal, onTool, onText) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const allowed = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'Skill', ...(ALLOW_WEB ? ['WebSearch', 'WebFetch'] : [])];
  const abort = new AbortController(); signal.addEventListener('abort', () => abort.abort(), { once: true });
  const stream = query({
    prompt: prompt(tool, contextFiles, inputFiles),
    options: {
      cwd: runDir,
      model: MODEL,
      effort: EFFORT,
      thinking: { type: 'adaptive' },
      systemPrompt: { type: 'preset', preset: 'claude_code', append: SYSTEM },
      settingSources: [], // nothing from the host: skills come only from the portal's plugin
      plugins: [{ type: 'local', path: PLUGIN_DIR }],
      skills: 'all',
      tools: allowed,
      allowedTools: allowed,
      permissionMode: 'dontAsk',
      maxTurns: MAX_TURNS,
      maxBudgetUsd: MAX_BUDGET,
      abortController: abort,
      persistSession: false,
      // The agent's shell sees only what it needs: no CRM address, no data keys.
      env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'en_AU.UTF-8', TZ: process.env.TZ || 'Australia/Melbourne', ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, CLAUDE_AGENT_SDK_CLIENT_APP: 'brightday-advice-tools/0.1.0' },
    },
  });
  let summary = ''; let cost = null; let sessionId = null; let failure = null;
  for await (const m of stream) {
    if (m.type === 'system' && m.session_id && !sessionId) sessionId = m.session_id;
    else if (m.type === 'assistant' && !m.parent_tool_use_id) {
      for (const b of m.message.content || []) {
        if (b.type === 'text' && b.text.trim()) onText(b.text.trim());
        if (b.type === 'tool_use') onTool(b.name, b.input);
      }
    } else if (m.type === 'result') {
      cost = m.total_cost_usd;
      if (m.subtype === 'success' && !m.is_error) summary = m.result; else failure = m.subtype === 'success' ? m.result : 'The agent stopped: ' + m.subtype;
    }
  }
  if (failure) { const e = new Error(failure); e.cost = cost; e.sessionId = sessionId; throw e; }
  return { summary, cost, sessionId };
}

/** Encrypt every file in the run folder at rest (no-op without DATA_KEYS). Returns true when sealed. */
function sealFolder(runDir) {
  if (!vault.enabled()) return false;
  for (const rel of walk(runDir)) {
    if (rel.endsWith('.sealed')) continue;
    const f = path.join(runDir, rel);
    fs.writeFileSync(f + '.sealed', vault.sealBuf(fs.readFileSync(f))); fs.rmSync(f);
  }
  return true;
}

const controllers = new Map();

async function execute(runId) {
  const run = store.runs.get(runId); if (!run || run.status !== 'queued') return;
  const tool = TOOL[run.tool];
  const runDir = path.join(store.RUNS_DIR, runId);
  const ctl = new AbortController(); controllers.set(runId, ctl);
  store.runs.update(runId, { status: 'running', startedAt: store.now() });
  emit(runId, 'status', 'Starting ' + tool.name);
  const contextFiles = walk(path.join(runDir, 'context')).map((f) => 'context/' + f);
  const inputFiles = walk(path.join(runDir, 'inputs')).map((f) => 'inputs/' + f);
  fs.mkdirSync(path.join(runDir, 'outputs'), { recursive: true });
  const onTool = (name, input) => emit(runId, 'tool', describe(name, input));
  const onText = (text) => emit(runId, 'text', text);

  let result = null; let failure = null;
  try {
    result = FAKE ? await fakeAgent(tool, runDir, ctl.signal, onTool, onText) : await realAgent(tool, runDir, contextFiles, inputFiles, ctl.signal, onTool, onText);
  } catch (e) { failure = ctl.signal.aborted ? 'Cancelled' : e.message; result = { cost: e.cost ?? null, sessionId: e.sessionId ?? null }; }
  controllers.delete(runId);

  // Whatever landed in outputs/ is kept, even from a failed run, so partial work is visible.
  const outputs = walk(path.join(runDir, 'outputs'));
  const docs = outputs.map((rel) => {
    const f = path.join(runDir, 'outputs', rel); const buf = fs.readFileSync(f);
    return { id: crypto.randomUUID(), runId, clientId: run.clientId, filename: path.basename(rel), rel: path.join('outputs', rel), mime: mimeOf(rel), size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
  });
  const sealed = sealFolder(runDir);
  for (const d of docs) store.documents.insert({ ...d, path: path.join('runs', runId, d.rel + (sealed ? '.sealed' : '')), sealed, status: tool.approval ? 'draft' : 'final' });

  const cancelled = store.runs.get(runId).status === 'cancelled' || failure === 'Cancelled';
  const status = cancelled ? 'cancelled' : failure ? 'failed' : tool.approval && docs.length ? 'review' : 'done';
  store.runs.update(runId, { status, summary: result.summary || null, error: cancelled ? null : failure, costUsd: result.cost, sessionId: result.sessionId, finishedAt: status === 'review' ? null : store.now() });
  if (failure && !cancelled) emit(runId, 'error', failure);
  emit(runId, 'end', status === 'review' ? `${docs.length} document${docs.length === 1 ? '' : 's'} ready for adviser review` : status === 'done' ? `Finished with ${docs.length} document${docs.length === 1 ? '' : 's'}` : 'Run ' + status);
}

const queue = []; let active = 0;
function pump() {
  while (active < SLOTS && queue.length) {
    const id = queue.shift(); active++;
    execute(id).catch((e) => { console.error('[run]', id, e); try { store.runs.update(id, { status: 'failed', error: e.message, finishedAt: store.now() }); emit(id, 'error', e.message); } catch (_) { /* ignore */ } })
      .finally(() => { active--; pump(); });
  }
}
export function enqueue(runId) { queue.push(runId); pump(); }

export function cancel(runId) {
  const run = store.runs.get(runId); if (!run) return false;
  if (run.status === 'queued') { const i = queue.indexOf(runId); if (i >= 0) queue.splice(i, 1); }
  else if (run.status !== 'running') return false;
  store.runs.update(runId, { status: 'cancelled', finishedAt: store.now() });
  controllers.get(runId)?.abort();
  if (run.status === 'queued') emit(runId, 'end', 'Run cancelled');
  return true;
}

/** On boot: runs cut off by a restart are marked failed; queued runs start again. */
export function resume() {
  for (const id of store.runs.byStatus('running')) { store.runs.update(id, { status: 'failed', error: 'Interrupted by a restart. Start the run again.', finishedAt: store.now() }); emit(id, 'end', 'Run failed'); }
  for (const id of store.runs.byStatus('queued')) enqueue(id);
}

export const info = () => ({ model: MODEL, fake: FAKE, plugin: PLUGIN_DIR, skills: walk(path.join(PLUGIN_DIR, 'skills')).filter((f) => f.endsWith('SKILL.md')).map((f) => path.dirname(f)) });
