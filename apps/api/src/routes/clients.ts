import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { calendarEvents, clientNotes, clients, documents, emails, tasks, toolRuns, users } from '@tms/db';
import { relinkClient } from '@tms/msgraph';
import { clientInput } from '@tms/shared';
import { z } from 'zod';
import { audit } from '../audit';
import { db } from '../context';
import { notFound, parse, uuidParam } from '../http';

const clientSelect = {
  id: clients.id,
  name: clients.name,
  type: clients.type,
  status: clients.status,
  emails: clients.emails,
  phone: clients.phone,
  adviserId: clients.adviserId,
  adviserName: users.name,
  platform: clients.platform,
  fum: clients.fum,
  ongoingFee: clients.ongoingFee,
  reviewMonth: clients.reviewMonth,
  nextReviewDate: clients.nextReviewDate,
  ofaRenewalDate: clients.ofaRenewalDate,
  notes: clients.notes,
  createdAt: clients.createdAt,
};

export async function getClient(id: string) {
  const [row] = await db.select(clientSelect).from(clients).leftJoin(users, eq(users.id, clients.adviserId)).where(eq(clients.id, id));
  return row ?? null;
}

export async function clientRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.requireUser);

  app.get('/api/clients', async (req) => {
    const q = parse(
      z.object({ q: z.string().max(100).optional(), status: z.enum(['prospect', 'active', 'inactive']).optional() }),
      req.query,
    );
    const where = and(
      q.q ? or(ilike(clients.name, `%${q.q}%`), sql`${q.q.toLowerCase()} = ANY(${clients.emails})`) : undefined,
      q.status ? eq(clients.status, q.status) : undefined,
    );
    return db.select(clientSelect).from(clients).leftJoin(users, eq(users.id, clients.adviserId)).where(where).orderBy(asc(clients.name));
  });

  app.post('/api/clients', async (req, reply) => {
    const input = parse(clientInput, req.body);
    const emailsLower = input.emails.map((e) => e.toLowerCase());
    const [row] = await db.insert(clients).values({ ...input, emails: emailsLower }).returning();
    await relinkClient(db, row!.id, emailsLower);
    await audit(req, 'create', 'client', row!.id);
    return reply.code(201).send(await getClient(row!.id));
  });

  app.get('/api/clients/:id', async (req) => {
    const { id } = parse(uuidParam, req.params);
    const client = await getClient(id);
    if (!client) throw notFound('Client not found');
    await audit(req, 'view', 'client', id);
    return client;
  });

  app.patch('/api/clients/:id', async (req) => {
    const { id } = parse(uuidParam, req.params);
    const input = parse(clientInput.partial(), req.body);
    if (input.emails) input.emails = input.emails.map((e) => e.toLowerCase());
    const [row] = await db.update(clients).set({ ...input, updatedAt: new Date().toISOString() }).where(eq(clients.id, id)).returning();
    if (!row) throw notFound('Client not found');
    if (input.emails) await relinkClient(db, id, input.emails);
    await audit(req, 'update', 'client', id, { fields: Object.keys(input) });
    return getClient(id);
  });

  /** Everything the portal knows about a client, for the client page. */
  app.get('/api/clients/:id/activity', async (req) => {
    const { id } = parse(uuidParam, req.params);
    const [mail, meetings, notes, clientTasks, runs, docs] = await Promise.all([
      db
        .select({
          id: emails.id, subject: emails.subject, fromName: emails.fromName, fromEmail: emails.fromEmail, to: emails.to,
          preview: emails.preview, receivedAt: emails.receivedAt, isRead: emails.isRead, hasAttachments: emails.hasAttachments,
          webLink: emails.webLink, clientId: emails.clientId,
        })
        .from(emails).where(eq(emails.clientId, id)).orderBy(desc(emails.receivedAt)).limit(100),
      db.select().from(calendarEvents).where(eq(calendarEvents.clientId, id)).orderBy(desc(calendarEvents.start)).limit(50),
      db
        .select({ id: clientNotes.id, body: clientNotes.body, createdAt: clientNotes.createdAt, authorName: users.name })
        .from(clientNotes).innerJoin(users, eq(users.id, clientNotes.authorId))
        .where(eq(clientNotes.clientId, id)).orderBy(desc(clientNotes.createdAt)),
      db.select().from(tasks).where(eq(tasks.clientId, id)).orderBy(asc(tasks.status), asc(tasks.dueDate)),
      db.select().from(toolRuns).where(eq(toolRuns.clientId, id)).orderBy(desc(toolRuns.createdAt)).limit(50),
      db.select().from(documents).where(eq(documents.clientId, id)).orderBy(desc(documents.createdAt)),
    ]);
    return { emails: mail, meetings, notes, tasks: clientTasks, runs, documents: docs };
  });

  app.post('/api/clients/:id/notes', async (req, reply) => {
    const { id } = parse(uuidParam, req.params);
    const { body } = parse(z.object({ body: z.string().trim().min(1).max(20000) }), req.body);
    const [row] = await db.insert(clientNotes).values({ clientId: id, authorId: req.user!.id, body }).returning();
    await audit(req, 'create', 'client_note', row!.id, { clientId: id });
    return reply.code(201).send({ ...row, authorName: req.user!.name });
  });
}
