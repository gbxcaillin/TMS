import type { FastifyInstance } from 'fastify';
import { alias } from 'drizzle-orm/pg-core';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { clients, tasks, users } from '@tms/db';
import { taskInput } from '@tms/shared';
import { z } from 'zod';
import { audit } from '../audit';
import { db } from '../context';
import { noContent, notFound, parse, uuidParam } from '../http';

const assignee = alias(users, 'assignee');

export const taskSelect = {
  id: tasks.id,
  title: tasks.title,
  notes: tasks.notes,
  status: tasks.status,
  priority: tasks.priority,
  dueDate: tasks.dueDate,
  clientId: tasks.clientId,
  clientName: clients.name,
  assigneeId: tasks.assigneeId,
  assigneeName: assignee.name,
  createdAt: tasks.createdAt,
};

export function taskQuery() {
  return db.select(taskSelect).from(tasks).leftJoin(clients, eq(clients.id, tasks.clientId)).leftJoin(assignee, eq(assignee.id, tasks.assigneeId));
}

export async function taskRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.requireUser);

  app.get('/api/tasks', async (req) => {
    const q = parse(
      z.object({
        scope: z.enum(['mine', 'all']).default('mine'),
        clientId: z.string().uuid().optional(),
        includeDone: z.enum(['true', 'false']).default('false'),
      }),
      req.query,
    );
    return taskQuery()
      .where(
        and(
          q.scope === 'mine' ? eq(tasks.assigneeId, req.user!.id) : undefined,
          q.clientId ? eq(tasks.clientId, q.clientId) : undefined,
          q.includeDone === 'true' ? undefined : ne(tasks.status, 'done'),
        ),
      )
      .orderBy(sql`${tasks.dueDate} ASC NULLS LAST`, asc(tasks.createdAt));
  });

  app.post('/api/tasks', async (req, reply) => {
    const input = parse(taskInput, req.body);
    const [row] = await db
      .insert(tasks)
      .values({ ...input, assigneeId: input.assigneeId ?? req.user!.id, createdById: req.user!.id })
      .returning();
    await audit(req, 'create', 'task', row!.id);
    const [full] = await taskQuery().where(eq(tasks.id, row!.id));
    return reply.code(201).send(full);
  });

  app.patch('/api/tasks/:id', async (req) => {
    const { id } = parse(uuidParam, req.params);
    const input = parse(taskInput.partial(), req.body);
    const now = new Date().toISOString();
    const completedAt = input.status === undefined ? undefined : input.status === 'done' ? now : null;
    const [row] = await db.update(tasks).set({ ...input, completedAt, updatedAt: now }).where(eq(tasks.id, id)).returning();
    if (!row) throw notFound('Task not found');
    await audit(req, 'update', 'task', id, { fields: Object.keys(input) });
    const [full] = await taskQuery().where(eq(tasks.id, id));
    return full;
  });

  app.delete('/api/tasks/:id', async (req, reply) => {
    const { id } = parse(uuidParam, req.params);
    const [row] = await db.delete(tasks).where(eq(tasks.id, id)).returning({ id: tasks.id });
    if (!row) throw notFound('Task not found');
    await audit(req, 'delete', 'task', id);
    return noContent(reply);
  });
}
