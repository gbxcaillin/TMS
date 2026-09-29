/**
 * Writes the portal data a tool needs into <run>/context/ so the agent reads
 * plain files instead of having database access.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';
import { calendarEvents, clientNotes, clients, emails, tasks, users } from '@tms/db';
import { getGraphToken, graphGet, msalConfigFromEnv } from '@tms/msgraph';
import type { ToolDefinition } from '@tms/shared';
import { db } from './context';

interface Period { start: string; end: string }

function periodFor(inputs: Record<string, unknown>): Period {
  const end = typeof inputs.periodEnd === 'string' ? inputs.periodEnd : new Date().toISOString().slice(0, 10);
  const start =
    typeof inputs.periodStart === 'string'
      ? inputs.periodStart
      : new Date(new Date(end).getTime() - 365 * 86_400_000).toISOString().slice(0, 10);
  return { start, end };
}

/** Emails linked to a client after they were synced have no stored body; fetch those on demand. */
async function backfillBodies(clientId: string, period: Period) {
  const cfg = msalConfigFromEnv();
  if (!cfg) return;
  const missing = await db
    .select({ id: emails.id, userId: emails.userId, graphId: emails.graphId })
    .from(emails)
    .where(and(eq(emails.clientId, clientId), isNull(emails.bodyText), gte(emails.receivedAt, period.start), lte(emails.receivedAt, `${period.end}T23:59:59Z`)));
  const tokens = new Map<string, string | null>();
  for (const m of missing) {
    if (!tokens.has(m.userId)) tokens.set(m.userId, await getGraphToken(cfg, db, m.userId).catch(() => null));
    const token = tokens.get(m.userId);
    if (!token) continue;
    const msg = await graphGet<{ body?: { content: string } }>(token, `/me/messages/${encodeURIComponent(m.graphId)}?$select=body`, {
      Prefer: 'outlook.body-content-type="text"',
    }).catch(() => null);
    if (msg?.body) await db.update(emails).set({ bodyText: msg.body.content.slice(0, 100_000) }).where(eq(emails.id, m.id));
  }
}

export async function writeRunContext(runDir: string, tool: ToolDefinition, clientId: string | null, inputs: Record<string, unknown>) {
  const dir = path.join(runDir, 'context');
  await mkdir(dir, { recursive: true });
  const written: string[] = [];
  const put = async (name: string, content: string) => {
    await writeFile(path.join(dir, name), content, 'utf8');
    written.push(`context/${name}`);
  };

  if (!clientId) return written;
  const period = periodFor(inputs);

  const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
  if (!client) return written;
  const [adviser] = client.adviserId ? await db.select().from(users).where(eq(users.id, client.adviserId)) : [];

  if (tool.context.includes('client')) {
    await put(
      'client.json',
      JSON.stringify(
        {
          name: client.name, type: client.type, status: client.status, emails: client.emails, phone: client.phone,
          adviser: adviser ? { name: adviser.name, email: adviser.email } : null,
          platform: client.platform, fundsUnderManagement: client.fum, currentOngoingFee: client.ongoingFee,
          nextReviewDate: client.nextReviewDate, ofaRenewalDate: client.ofaRenewalDate, profileNotes: client.notes,
        },
        null,
        2,
      ),
    );
  }

  if (tool.context.includes('emails')) {
    await backfillBodies(clientId, period);
    const rows = await db
      .select()
      .from(emails)
      .where(and(eq(emails.clientId, clientId), gte(emails.receivedAt, period.start), lte(emails.receivedAt, `${period.end}T23:59:59Z`)))
      .orderBy(asc(emails.receivedAt));
    // De-duplicate messages seen by more than one staff mailbox.
    const seen = new Set<string>();
    const parts = rows
      .filter((e) => {
        const key = `${e.subject}|${e.fromEmail}|${e.receivedAt}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((e) =>
        [`## ${e.subject || '(no subject)'}`, `Date: ${e.receivedAt}`, `From: ${e.fromName} <${e.fromEmail}>`, `To: ${e.to.join(', ')}`, '', e.bodyText ?? e.preview].join('\n'),
      );
    await put('emails.md', `# Correspondence ${period.start} to ${period.end} (${parts.length} emails)\n\n${parts.join('\n\n---\n\n')}`);
  }

  if (tool.context.includes('meetings')) {
    const rows = await db
      .select({ subject: calendarEvents.subject, start: calendarEvents.start, end: calendarEvents.end, attendees: calendarEvents.attendees, notes: calendarEvents.bodyPreview })
      .from(calendarEvents)
      .where(and(eq(calendarEvents.clientId, clientId), gte(calendarEvents.start, period.start), lte(calendarEvents.start, `${period.end}T23:59:59Z`)))
      .orderBy(asc(calendarEvents.start));
    const unique = [...new Map(rows.map((r) => [`${r.subject}|${r.start}`, r])).values()];
    await put('meetings.json', JSON.stringify(unique, null, 2));
  }

  if (tool.context.includes('notes')) {
    const rows = await db
      .select({ body: clientNotes.body, createdAt: clientNotes.createdAt, author: users.name })
      .from(clientNotes)
      .innerJoin(users, eq(users.id, clientNotes.authorId))
      .where(eq(clientNotes.clientId, clientId))
      .orderBy(asc(clientNotes.createdAt));
    await put('file-notes.md', rows.map((n) => `## ${n.createdAt.slice(0, 10)} — ${n.author}\n\n${n.body}`).join('\n\n') || 'No file notes recorded.');
  }

  if (tool.context.includes('tasks')) {
    const rows = await db
      .select({ title: tasks.title, status: tasks.status, dueDate: tasks.dueDate, completedAt: tasks.completedAt, notes: tasks.notes })
      .from(tasks)
      .where(eq(tasks.clientId, clientId));
    await put('tasks.json', JSON.stringify(rows, null, 2));
  }

  return written;
}
