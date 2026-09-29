import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, ilike, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { calendarEvents, clients, emails, graphSyncState } from '@tms/db';
import { z } from 'zod';
import { audit } from '../audit';
import { db, graphSyncQueue } from '../context';
import { notFound, parse, uuidParam } from '../http';

export const eventSelect = {
  id: calendarEvents.id,
  subject: calendarEvents.subject,
  start: calendarEvents.start,
  end: calendarEvents.end,
  location: calendarEvents.location,
  isOnline: calendarEvents.isOnline,
  attendees: calendarEvents.attendees,
  clientId: calendarEvents.clientId,
  clientName: clients.name,
  webLink: calendarEvents.webLink,
};

export const emailSelect = {
  id: emails.id,
  subject: emails.subject,
  fromName: emails.fromName,
  fromEmail: emails.fromEmail,
  to: emails.to,
  preview: emails.preview,
  receivedAt: emails.receivedAt,
  isRead: emails.isRead,
  hasAttachments: emails.hasAttachments,
  clientId: emails.clientId,
  clientName: clients.name,
  webLink: emails.webLink,
};

export async function outlookRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.requireUser);

  app.get('/api/calendar', async (req) => {
    const q = parse(z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) }), req.query);
    return db
      .select(eventSelect)
      .from(calendarEvents)
      .leftJoin(clients, eq(clients.id, calendarEvents.clientId))
      .where(and(eq(calendarEvents.userId, req.user!.id), gte(calendarEvents.end, q.from), lt(calendarEvents.start, q.to)))
      .orderBy(calendarEvents.start);
  });

  app.get('/api/emails', async (req) => {
    const q = parse(
      z.object({
        q: z.string().max(200).optional(),
        filter: z.enum(['all', 'clients', 'unlinked', 'unread']).default('all'),
        before: z.string().datetime({ offset: true }).optional(),
      }),
      req.query,
    );
    return db
      .select(emailSelect)
      .from(emails)
      .leftJoin(clients, eq(clients.id, emails.clientId))
      .where(
        and(
          eq(emails.userId, req.user!.id),
          q.q ? or(ilike(emails.subject, `%${q.q}%`), ilike(emails.fromName, `%${q.q}%`), ilike(emails.fromEmail, `%${q.q}%`)) : undefined,
          q.filter === 'clients' ? isNotNull(emails.clientId) : undefined,
          q.filter === 'unlinked' ? isNull(emails.clientId) : undefined,
          q.filter === 'unread' ? eq(emails.isRead, false) : undefined,
          q.before ? lt(emails.receivedAt, q.before) : undefined,
        ),
      )
      .orderBy(desc(emails.receivedAt))
      .limit(50);
  });

  /** Manually file an email against a client (or unlink it). */
  app.patch('/api/emails/:id', async (req) => {
    const { id } = parse(uuidParam, req.params);
    const { clientId } = parse(z.object({ clientId: z.string().uuid().nullable() }), req.body);
    const [row] = await db
      .update(emails)
      .set({ clientId })
      .where(and(eq(emails.id, id), eq(emails.userId, req.user!.id)))
      .returning({ id: emails.id });
    if (!row) throw notFound('Email not found');
    await audit(req, 'link', 'email', id, { clientId });
    return { ok: true };
  });

  app.post('/api/sync', async (req) => {
    await graphSyncQueue.add('sync', { userId: req.user!.id }, { jobId: `sync-${req.user!.id}-manual-${Date.now()}` });
    return { queued: true };
  });

  app.get('/api/sync/status', async (req) =>
    db.select().from(graphSyncState).where(eq(graphSyncState.userId, req.user!.id)),
  );
}
