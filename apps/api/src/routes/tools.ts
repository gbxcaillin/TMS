import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gt } from 'drizzle-orm';
import { clients, documents, toolRunEvents, toolRuns, users } from '@tms/db';
import { TOOLS, TOOLS_BY_ID, channels, documentDecision, isToolId } from '@tms/shared';
import { z } from 'zod';
import { audit } from '../audit';
import { db, subscribe, toolRunQueue } from '../context';
import { env } from '../env';
import { HttpError, notFound, parse, uuidParam } from '../http';

const dataDir = path.resolve(env.DATA_DIR);

export function safeFilename(name: string) {
  const base = path.basename(name).normalize('NFKC').replace(/[^\w.\- ()]+/g, '_').replace(/^\.+/, '');
  return base.slice(0, 150) || 'file';
}

const runSelect = {
  id: toolRuns.id,
  tool: toolRuns.tool,
  status: toolRuns.status,
  clientId: toolRuns.clientId,
  clientName: clients.name,
  inputs: toolRuns.inputs,
  summary: toolRuns.summary,
  error: toolRuns.error,
  costUsd: toolRuns.costUsd,
  createdById: toolRuns.createdById,
  createdByName: users.name,
  createdAt: toolRuns.createdAt,
  finishedAt: toolRuns.finishedAt,
};

export function runQuery() {
  return db.select(runSelect).from(toolRuns).leftJoin(clients, eq(clients.id, toolRuns.clientId)).leftJoin(users, eq(users.id, toolRuns.createdById));
}

export async function toolRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.requireUser);

  app.get('/api/tools', async () => TOOLS);

  /** Start a run. multipart/form-data: text fields + files keyed by the tool's field keys. */
  app.post<{ Params: { tool: string } }>('/api/tools/:tool/runs', async (req, reply) => {
    if (!isToolId(req.params.tool)) throw notFound('Unknown tool');
    const tool = TOOLS_BY_ID[req.params.tool];
    const runId = randomUUID();
    const runDir = path.join(dataDir, 'runs', runId);
    const inputs: Record<string, unknown> = {};
    const files: Record<string, string[]> = {};
    const allowedFileKeys = new Set(tool.fields.filter((f) => f.kind === 'files').map((f) => f.key));
    const allowedTextKeys = new Set(tool.fields.filter((f) => f.kind !== 'files').map((f) => f.key));

    for await (const part of req.parts({ limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 30 } })) {
      if (part.type === 'file') {
        if (!allowedFileKeys.has(part.fieldname)) {
          part.file.resume();
          throw new HttpError(400, `Unexpected file field ${part.fieldname}`);
        }
        const dir = path.join(runDir, 'inputs', part.fieldname);
        await mkdir(dir, { recursive: true });
        const name = safeFilename(part.filename);
        await pipeline(part.file, createWriteStream(path.join(dir, name)));
        if (part.file.truncated) throw new HttpError(413, `${name} exceeds ${env.MAX_UPLOAD_MB} MB`);
        (files[part.fieldname] ??= []).push(`inputs/${part.fieldname}/${name}`);
      } else if (allowedTextKeys.has(part.fieldname)) {
        const value = String(part.value ?? '').trim();
        if (value) inputs[part.fieldname] = value.slice(0, 20_000);
      }
    }

    for (const field of tool.fields) {
      const present = field.kind === 'files' ? !!files[field.key]?.length : inputs[field.key] !== undefined;
      if (field.required && !present) throw new HttpError(400, `${field.label} is required`);
      if (field.kind === 'select' && present && !field.options.some((o) => o.value === inputs[field.key])) {
        throw new HttpError(400, `Invalid value for ${field.label}`);
      }
    }

    const clientId = typeof inputs.clientId === 'string' ? inputs.clientId : null;
    if (clientId) {
      const [c] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, parse(z.string().uuid(), clientId)));
      if (!c) throw new HttpError(400, 'Client not found');
    }

    await db.insert(toolRuns).values({
      id: runId,
      tool: tool.id,
      clientId,
      inputs: { ...inputs, files },
      createdById: req.user!.id,
    });
    await db.insert(toolRunEvents).values({ runId, kind: 'status', message: 'Queued' });
    await toolRunQueue.add('run', { runId }, { jobId: runId, attempts: 1, removeOnComplete: 1000, removeOnFail: 1000 });
    await audit(req, 'start', 'tool_run', runId, { tool: tool.id, clientId });
    const [run] = await runQuery().where(eq(toolRuns.id, runId));
    return reply.code(201).send(run);
  });

  app.get('/api/runs', async (req) => {
    const q = parse(z.object({ clientId: z.string().uuid().optional(), tool: z.string().optional() }), req.query);
    return runQuery()
      .where(and(q.clientId ? eq(toolRuns.clientId, q.clientId) : undefined, q.tool ? eq(toolRuns.tool, q.tool) : undefined))
      .orderBy(desc(toolRuns.createdAt))
      .limit(100);
  });

  app.get('/api/runs/:id', async (req) => {
    const { id } = parse(uuidParam, req.params);
    const [run] = await runQuery().where(eq(toolRuns.id, id));
    if (!run) throw notFound('Run not found');
    const docs = await db.select().from(documents).where(eq(documents.runId, id)).orderBy(asc(documents.filename));
    return { ...run, documents: docs };
  });

  app.post('/api/runs/:id/cancel', async (req) => {
    const { id } = parse(uuidParam, req.params);
    const [run] = await db.select().from(toolRuns).where(eq(toolRuns.id, id));
    if (!run) throw notFound('Run not found');
    if (run.status === 'queued') {
      await toolRunQueue.remove(id);
    } else if (run.status !== 'running') {
      throw new HttpError(409, `Run is ${run.status}`);
    }
    // The worker polls for this status and aborts the agent.
    await db.update(toolRuns).set({ status: 'cancelled', finishedAt: new Date().toISOString() }).where(eq(toolRuns.id, id));
    await audit(req, 'cancel', 'tool_run', id);
    return { ok: true };
  });

  /** Server-sent events: replays stored events after Last-Event-ID, then streams live ones. */
  app.get('/api/runs/:id/events', async (req, reply) => {
    const { id } = parse(uuidParam, req.params);
    const lastId = Number(req.headers['last-event-id'] ?? 0) || 0;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    let sent = lastId;
    const send = (ev: { id: number }) => {
      if (ev.id <= sent) return;
      sent = ev.id;
      res.write(`id: ${ev.id}\ndata: ${JSON.stringify(ev)}\n\n`);
    };
    const unsubscribe = await subscribe(channels.run(id), (msg) => send(JSON.parse(msg)));
    const backlog = await db.select().from(toolRunEvents).where(and(eq(toolRunEvents.runId, id), gt(toolRunEvents.id, lastId))).orderBy(asc(toolRunEvents.id));
    backlog.forEach(send);
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.raw.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  app.get('/api/documents/:id/download', async (req, reply) => {
    const { id } = parse(uuidParam, req.params);
    const [doc] = await db.select().from(documents).where(eq(documents.id, id));
    if (!doc) throw notFound('Document not found');
    const full = path.resolve(dataDir, doc.storagePath);
    if (!full.startsWith(dataDir + path.sep)) throw new HttpError(400, 'Invalid document path');
    await stat(full).catch(() => {
      throw notFound('File missing from storage');
    });
    await audit(req, 'download', 'document', id);
    reply.header('Content-Type', doc.mimeType);
    reply.header('Content-Disposition', `attachment; filename="${doc.filename.replace(/"/g, '')}"`);
    return reply.send(createReadStream(full));
  });

  /** Adviser sign-off. Compliance documents (SOA/ROA, review, OFA) stay drafts until approved. */
  app.post('/api/documents/:id/decision', async (req) => {
    const { id } = parse(uuidParam, req.params);
    if (!['adviser', 'admin'].includes(req.user!.role)) throw new HttpError(403, 'Only advisers can approve documents');
    const input = parse(documentDecision, req.body);
    const now = new Date().toISOString();
    const [doc] = await db
      .update(documents)
      .set({ status: input.decision, approvedById: req.user!.id, approvedAt: now, reviewComment: input.comment ?? null })
      .where(eq(documents.id, id))
      .returning();
    if (!doc) throw notFound('Document not found');
    await audit(req, input.decision === 'approved' ? 'approve' : 'reject', 'document', id, { comment: input.comment });

    if (doc.runId) {
      const siblings = await db.select({ status: documents.status }).from(documents).where(eq(documents.runId, doc.runId));
      if (siblings.every((d) => d.status === 'approved')) {
        await db
          .update(toolRuns)
          .set({ status: 'completed', finishedAt: now })
          .where(and(eq(toolRuns.id, doc.runId), eq(toolRuns.status, 'awaiting_review')));
      }
    }
    return doc;
  });
}
