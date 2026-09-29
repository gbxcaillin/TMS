import { and, eq, inArray, sql } from 'drizzle-orm';
import { calendarEvents, clients, emails, graphSyncState, type Db } from '@tms/db';
import { GraphError, walkDelta } from './graph';

interface GraphRecipient { emailAddress?: { name?: string; address?: string } }
interface GraphMessage {
  id: string;
  '@removed'?: unknown;
  conversationId?: string;
  subject?: string;
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  bodyPreview?: string;
  body?: { contentType: string; content: string };
  receivedDateTime?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  webLink?: string;
}
interface GraphEvent {
  id: string;
  '@removed'?: unknown;
  subject?: string;
  start?: { dateTime: string; timeZone: string };
  end?: { dateTime: string; timeZone: string };
  location?: { displayName?: string };
  isOnlineMeeting?: boolean;
  attendees?: GraphRecipient[];
  organizer?: GraphRecipient;
  bodyPreview?: string;
  webLink?: string;
  isCancelled?: boolean;
}

const addr = (r?: GraphRecipient) => r?.emailAddress?.address?.toLowerCase() ?? '';
/** Graph returns UTC when asked via Prefer: outlook.timezone="UTC"; append Z so Postgres reads it as UTC. */
const utc = (dt?: { dateTime: string }) => (dt ? `${dt.dateTime.replace(/Z?$/, '')}Z` : new Date().toISOString());

/** email address -> client id, for linking Outlook items to clients. */
export async function loadClientEmailIndex(db: Db): Promise<Map<string, string>> {
  const rows = await db.select({ id: clients.id, emails: clients.emails }).from(clients);
  const map = new Map<string, string>();
  for (const row of rows) for (const e of row.emails) map.set(e.toLowerCase(), row.id);
  return map;
}

function matchClient(index: Map<string, string>, addresses: string[]): string | null {
  for (const a of addresses) {
    const id = index.get(a);
    if (id) return id;
  }
  return null;
}

async function getState(db: Db, userId: string, resource: string) {
  const [row] = await db
    .select()
    .from(graphSyncState)
    .where(and(eq(graphSyncState.userId, userId), eq(graphSyncState.resource, resource)));
  return row;
}

async function saveState(db: Db, userId: string, resource: string, deltaLink: string | null, lastError: string | null) {
  const now = new Date().toISOString();
  await db
    .insert(graphSyncState)
    .values({ userId, resource, deltaLink, lastSyncedAt: now, lastError })
    .onConflictDoUpdate({
      target: [graphSyncState.userId, graphSyncState.resource],
      set: lastError ? { lastError } : { deltaLink, lastSyncedAt: now, lastError: null },
    });
}

export interface SyncOptions {
  /** How far back the first sync reaches. Annual reviews need at least 12 months. */
  historyDays?: number;
  /** How far forward calendar sync reaches. */
  futureDays?: number;
}

const MAX_BODY_CHARS = 100_000;

export async function syncMailFolder(db: Db, token: string, userId: string, folder: 'inbox' | 'sentitems', opts: SyncOptions = {}) {
  const resource = `mail:${folder}`;
  const state = await getState(db, userId, resource);
  const since = new Date(Date.now() - (opts.historyDays ?? 400) * 86_400_000).toISOString();
  const select = 'id,conversationId,subject,from,toRecipients,ccRecipients,bodyPreview,body,receivedDateTime,isRead,hasAttachments,webLink';
  const start =
    state?.deltaLink ??
    `/me/mailFolders/${folder}/messages/delta?$select=${select}&$filter=${encodeURIComponent(`receivedDateTime ge ${since}`)}`;
  const index = await loadClientEmailIndex(db);
  let upserted = 0;
  let removed = 0;

  try {
    const it = walkDelta<GraphMessage>(token, start, { Prefer: 'outlook.body-content-type="text", odata.maxpagesize=50' });
    let step = await it.next();
    while (!step.done) {
      const page = step.value;
      const gone = page.value.filter((m) => m['@removed']).map((m) => m.id);
      if (gone.length) {
        await db.delete(emails).where(and(eq(emails.userId, userId), inArray(emails.graphId, gone)));
        removed += gone.length;
      }
      for (const m of page.value) {
        if (m['@removed']) continue;
        const to = (m.toRecipients ?? []).map(addr).filter(Boolean);
        const cc = (m.ccRecipients ?? []).map(addr).filter(Boolean);
        const clientId = matchClient(index, [addr(m.from), ...to, ...cc]);
        const values = {
          userId,
          graphId: m.id,
          conversationId: m.conversationId ?? null,
          subject: m.subject ?? '',
          fromName: m.from?.emailAddress?.name ?? '',
          fromEmail: addr(m.from),
          to,
          cc,
          preview: m.bodyPreview ?? '',
          // Only retain full bodies for client correspondence (needed for annual reviews).
          bodyText: clientId ? (m.body?.content ?? '').slice(0, MAX_BODY_CHARS) : null,
          receivedAt: m.receivedDateTime ?? new Date().toISOString(),
          isRead: m.isRead ?? false,
          hasAttachments: m.hasAttachments ?? false,
          webLink: m.webLink ?? null,
          clientId,
        };
        const { userId: _u, graphId: _g, ...update } = values;
        await db.insert(emails).values(values).onConflictDoUpdate({ target: [emails.userId, emails.graphId], set: update });
        upserted++;
      }
      step = await it.next();
    }
    await saveState(db, userId, resource, step.value ?? null, null);
  } catch (err) {
    // An expired delta token (410 / syncStateNotFound) means start again from scratch next time.
    if (err instanceof GraphError && (err.status === 410 || err.code === 'syncStateNotFound')) {
      await db.delete(graphSyncState).where(and(eq(graphSyncState.userId, userId), eq(graphSyncState.resource, resource)));
    } else {
      await saveState(db, userId, resource, state?.deltaLink ?? null, (err as Error).message);
    }
    throw err;
  }
  return { upserted, removed };
}

export async function syncCalendar(db: Db, token: string, userId: string, opts: SyncOptions = {}) {
  const resource = 'calendar';
  const state = await getState(db, userId, resource);
  const from = new Date(Date.now() - (opts.historyDays ?? 400) * 86_400_000).toISOString();
  const to = new Date(Date.now() + (opts.futureDays ?? 180) * 86_400_000).toISOString();
  const start = state?.deltaLink ?? `/me/calendarView/delta?startDateTime=${from}&endDateTime=${to}`;
  const index = await loadClientEmailIndex(db);
  let upserted = 0;
  let removed = 0;

  try {
    const it = walkDelta<GraphEvent>(token, start, { Prefer: 'outlook.timezone="UTC", odata.maxpagesize=50' });
    let step = await it.next();
    while (!step.done) {
      for (const ev of step.value.value) {
        if (ev['@removed'] || ev.isCancelled) {
          await db.delete(calendarEvents).where(and(eq(calendarEvents.userId, userId), eq(calendarEvents.graphId, ev.id)));
          removed++;
          continue;
        }
        const attendees = (ev.attendees ?? []).map((a) => ({ name: a.emailAddress?.name ?? '', email: addr(a) }));
        const values = {
          userId,
          graphId: ev.id,
          subject: ev.subject ?? '',
          start: utc(ev.start),
          end: utc(ev.end),
          location: ev.location?.displayName || null,
          isOnline: ev.isOnlineMeeting ?? false,
          attendees,
          bodyPreview: ev.bodyPreview ?? null,
          webLink: ev.webLink ?? null,
          clientId: matchClient(index, attendees.map((a) => a.email)),
          updatedAt: new Date().toISOString(),
        };
        const { userId: _u, graphId: _g, ...update } = values;
        await db
          .insert(calendarEvents)
          .values(values)
          .onConflictDoUpdate({ target: [calendarEvents.userId, calendarEvents.graphId], set: update });
        upserted++;
      }
      step = await it.next();
    }
    await saveState(db, userId, resource, step.value ?? null, null);
  } catch (err) {
    if (err instanceof GraphError && (err.status === 410 || err.code === 'syncStateNotFound')) {
      await db.delete(graphSyncState).where(and(eq(graphSyncState.userId, userId), eq(graphSyncState.resource, resource)));
    } else {
      await saveState(db, userId, resource, state?.deltaLink ?? null, (err as Error).message);
    }
    throw err;
  }
  return { upserted, removed };
}

/** Re-link existing mail and meetings after a client's email addresses change. */
export async function relinkClient(db: Db, clientId: string, addresses: string[]) {
  const lower = addresses.map((a) => a.toLowerCase());
  if (!lower.length) return;
  const arr = sql`ARRAY[${sql.join(lower.map((a) => sql`${a}`), sql`, `)}]::text[]`;
  await db
    .update(emails)
    .set({ clientId })
    .where(sql`${emails.clientId} IS NULL AND (${emails.fromEmail} = ANY(${arr}) OR ${emails.to} && ${arr} OR ${emails.cc} && ${arr})`);
  await db
    .update(calendarEvents)
    .set({ clientId })
    .where(
      sql`${calendarEvents.clientId} IS NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(${calendarEvents.attendees}) a WHERE lower(a->>'email') = ANY(${arr}))`,
    );
}
