import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq, gte, lt, lte, ne, sql, sum } from 'drizzle-orm';
import { calendarEvents, clients, emails, tasks, toolRuns } from '@tms/db';
import { db } from '../context';
import { emailSelect, eventSelect } from './outlook';
import { taskQuery } from './tasks';
import { runQuery } from './tools';

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.requireUser);

  app.get<{ Querystring: { tz?: string } }>('/api/dashboard', async (req) => {
    const userId = req.user!.id;
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const in7 = new Date(now.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
    const in45 = new Date(now.getTime() + 45 * 86_400_000).toISOString().slice(0, 10);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().slice(0, 10);

    const [meetingsToday, tasksDue, unreadEmails, reviewsDue, recentRuns, [totals], [reviews], [open]] = await Promise.all([
      db
        .select(eventSelect)
        .from(calendarEvents)
        .leftJoin(clients, eq(clients.id, calendarEvents.clientId))
        .where(and(eq(calendarEvents.userId, userId), gte(calendarEvents.end, dayStart.toISOString()), lt(calendarEvents.start, dayEnd.toISOString())))
        .orderBy(calendarEvents.start),
      taskQuery()
        .where(and(eq(tasks.assigneeId, userId), ne(tasks.status, 'done'), lte(tasks.dueDate, in7)))
        .orderBy(tasks.dueDate)
        .limit(10),
      db
        .select(emailSelect)
        .from(emails)
        .leftJoin(clients, eq(clients.id, emails.clientId))
        .where(and(eq(emails.userId, userId), eq(emails.isRead, false), sql`${emails.clientId} IS NOT NULL`))
        .orderBy(desc(emails.receivedAt))
        .limit(8),
      db
        .select()
        .from(clients)
        .where(and(eq(clients.status, 'active'), sql`LEAST(${clients.nextReviewDate}, ${clients.ofaRenewalDate}) <= ${in45}`))
        .orderBy(sql`LEAST(${clients.nextReviewDate}, ${clients.ofaRenewalDate})`)
        .limit(10),
      runQuery().orderBy(desc(toolRuns.createdAt)).limit(6),
      db.select({ clients: count(), fum: sum(clients.fum) }).from(clients).where(eq(clients.status, 'active')),
      db.select({ n: count() }).from(clients).where(and(gte(clients.nextReviewDate, monthStart), lt(clients.nextReviewDate, monthEnd))),
      db.select({ n: count() }).from(tasks).where(ne(tasks.status, 'done')),
    ]);

    return {
      meetingsToday,
      tasksDue,
      unreadEmails,
      reviewsDue,
      recentRuns,
      stats: { clients: totals?.clients ?? 0, fum: Number(totals?.fum ?? 0), reviewsThisMonth: reviews?.n ?? 0, openTasks: open?.n ?? 0 },
    };
  });
}
