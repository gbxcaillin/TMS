import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { eq } from 'drizzle-orm';
import { documents, toolRuns } from '@tms/db';
import { TOOLS_BY_ID, isToolId, type ToolDefinition } from '@tms/shared';
import { db, emit } from './context';
import { dataDir, env, pluginDir } from './env';
import { writeRunContext } from './run-context';

const MIME: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.html': 'text/html',
  '.png': 'image/png',
};

const SYSTEM_APPEND = `
You are working inside Brightday's adviser portal for an Australian financial advice practice.
Everything you produce is a DRAFT for a licensed adviser to review before it reaches a client.

Rules:
- Work only with files in the current directory: ./inputs (uploaded by the adviser), ./context (portal data), ./run.json (form inputs).
- Save every deliverable to ./outputs. Use clear filenames, e.g. "Annual Review - <Client> - <FY>.docx".
- Never invent figures. If a number is missing or ambiguous in the inputs, leave a clearly marked placeholder like [[CONFIRM: ...]] and list it in your summary.
- Do not send anything anywhere; there is no email or upload capability and none is needed.
- Finish with a short plain-English summary for the adviser: what you produced, key findings, and every item they must check or confirm.
`.trim();

function buildPrompt(tool: ToolDefinition, contextFiles: string[], inputFiles: string[]) {
  return [
    `Run the "${tool.skill}" skill for this job: ${tool.name}.`,
    '',
    `Form inputs are in ./run.json.`,
    inputFiles.length ? `Uploaded files:\n${inputFiles.map((f) => `- ./${f}`).join('\n')}` : 'No files were uploaded.',
    contextFiles.length ? `Portal context:\n${contextFiles.map((f) => `- ./${f}`).join('\n')}` : '',
    '',
    `Expected deliverables (save in ./outputs): ${tool.expectedOutputs.join('; ')}.`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** A short human-readable line for the progress feed. */
function describeToolUse(name: string, input: Record<string, unknown>): string {
  const file = (k: string) => (typeof input[k] === 'string' ? path.basename(input[k] as string) : '');
  switch (name) {
    case 'Read': return `Reading ${file('file_path')}`;
    case 'Write': return `Writing ${file('file_path')}`;
    case 'Edit': return `Editing ${file('file_path')}`;
    case 'Bash': return `Running: ${String(input.description ?? input.command ?? '').slice(0, 160)}`;
    case 'Glob':
    case 'Grep': return `Searching files (${String(input.pattern ?? '')})`;
    case 'Skill': return `Loading skill ${String(input.skill ?? input.name ?? '')}`;
    case 'WebSearch': return `Searching the web: ${String(input.query ?? '')}`;
    case 'WebFetch': return `Fetching ${String(input.url ?? '')}`;
    default: return `Using ${name}`;
  }
}

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(full, base)));
    else out.push(path.relative(base, full));
  }
  return out;
}

export async function runTool(runId: string) {
  const [run] = await db.select().from(toolRuns).where(eq(toolRuns.id, runId));
  if (!run) throw new Error(`Run ${runId} not found`);
  if (run.status !== 'queued') return; // cancelled before it started, or a duplicate delivery
  if (!isToolId(run.tool)) throw new Error(`Unknown tool ${run.tool}`);
  const tool = TOOLS_BY_ID[run.tool];

  const runDir = path.join(dataDir, 'runs', runId);
  const outputsDir = path.join(runDir, 'outputs');
  await mkdir(outputsDir, { recursive: true });

  await db.update(toolRuns).set({ status: 'running', startedAt: new Date().toISOString() }).where(eq(toolRuns.id, runId));
  await emit(runId, 'status', 'Preparing client context');

  const { files, ...formInputs } = run.inputs as { files?: Record<string, string[]> } & Record<string, unknown>;
  const contextFiles = await writeRunContext(runDir, tool, run.clientId, formInputs);
  await writeFile(path.join(runDir, 'run.json'), JSON.stringify({ tool: tool.id, inputs: formInputs }, null, 2));
  const inputFiles = Object.values(files ?? {}).flat();

  const abort = new AbortController();
  // Cancellation is requested through the API by flipping the run status.
  const cancelPoll = setInterval(async () => {
    const [r] = await db.select({ status: toolRuns.status }).from(toolRuns).where(eq(toolRuns.id, runId));
    if (r?.status === 'cancelled') abort.abort();
  }, 5000);

  await emit(runId, 'status', `Starting ${tool.name}`);
  let summary = '';
  let costUsd: number | null = null;
  let sessionId: string | null = null;
  let failure: string | null = null;

  try {
    const allowedTools = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'Skill'];
    if (env.AGENT_ALLOW_WEB === 'true') allowedTools.push('WebSearch', 'WebFetch');

    const stream = query({
      prompt: buildPrompt(tool, contextFiles, inputFiles),
      options: {
        cwd: runDir,
        model: env.AGENT_MODEL,
        effort: env.AGENT_EFFORT,
        thinking: { type: 'adaptive' },
        systemPrompt: { type: 'preset', preset: 'claude_code', append: SYSTEM_APPEND },
        // Isolated from any settings/CLAUDE.md on the host; skills come only from the portal plugin.
        settingSources: [],
        plugins: [{ type: 'local', path: pluginDir }],
        skills: 'all',
        tools: allowedTools,
        allowedTools,
        permissionMode: 'dontAsk',
        maxTurns: env.AGENT_MAX_TURNS,
        maxBudgetUsd: env.AGENT_MAX_BUDGET_USD,
        abortController: abort,
        persistSession: false,
        // The agent's shell sees only what it needs: no database or Redis credentials.
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          LANG: 'en_AU.UTF-8',
          TZ: 'Australia/Sydney',
          ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
          CLAUDE_AGENT_SDK_CLIENT_APP: 'brightday-portal/0.1.0',
        },
      },
    });

    for await (const message of stream as AsyncIterable<SDKMessage>) {
      if (message.type === 'system' && 'session_id' in message && !sessionId) {
        sessionId = message.session_id;
      } else if (message.type === 'assistant' && !message.parent_tool_use_id) {
        for (const block of message.message.content) {
          if (block.type === 'text' && block.text.trim()) await emit(runId, 'text', block.text.trim());
          if (block.type === 'tool_use') await emit(runId, 'tool', describeToolUse(block.name, block.input as Record<string, unknown>));
        }
      } else if (message.type === 'result') {
        costUsd = message.total_cost_usd;
        if (message.subtype === 'success' && !message.is_error) summary = message.result;
        else failure = message.subtype === 'success' ? message.result : `Agent stopped: ${message.subtype}`;
      }
    }
  } catch (err) {
    failure = abort.signal.aborted ? 'Cancelled' : (err as Error).message;
  } finally {
    clearInterval(cancelPoll);
  }

  // Register whatever landed in ./outputs, even on failure, so partial work is visible.
  const outputs = await listFiles(outputsDir);
  for (const rel of outputs) {
    const full = path.join(outputsDir, rel);
    const buf = await readFile(full);
    await db.insert(documents).values({
      runId,
      clientId: run.clientId,
      filename: path.basename(rel),
      storagePath: path.relative(dataDir, full),
      mimeType: MIME[path.extname(rel).toLowerCase()] ?? 'application/octet-stream',
      sizeBytes: (await stat(full)).size,
      sha256: createHash('sha256').update(buf).digest('hex'),
      status: tool.requiresApproval ? 'draft' : 'approved',
    });
  }

  const [current] = await db.select({ status: toolRuns.status }).from(toolRuns).where(eq(toolRuns.id, runId));
  const cancelled = current?.status === 'cancelled';
  const status = cancelled ? 'cancelled' : failure ? 'failed' : tool.requiresApproval && outputs.length ? 'awaiting_review' : 'completed';

  await db
    .update(toolRuns)
    .set({
      status,
      summary: summary || null,
      error: cancelled ? null : failure,
      costUsd,
      agentSessionId: sessionId,
      finishedAt: status === 'awaiting_review' ? null : new Date().toISOString(),
    })
    .where(eq(toolRuns.id, runId));

  if (failure && !cancelled) await emit(runId, 'error', failure);
  await emit(
    runId,
    'result',
    status === 'awaiting_review'
      ? `${outputs.length} document(s) ready for adviser review`
      : status === 'completed'
        ? `Finished with ${outputs.length} document(s)`
        : `Run ${status}`,
  );
}
