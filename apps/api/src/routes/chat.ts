import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, lt, sql } from 'drizzle-orm';
import { chatChannels, chatMessages, chatReads, users } from '@tms/db';
import { channelInput, channels, chatMessageInput, type ChatMessage } from '@tms/shared';
import { z } from 'zod';
import { db, redis, subscribe } from '../context';
import { HttpError, parse, uuidParam } from '../http';

export async function chatRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.requireUser);

  app.get('/api/chat/channels', async (req) => {
    const unread = sql<number>`(
      SELECT count(*)::int FROM ${chatMessages} m
      WHERE m.channel_id = ${chatChannels.id}
        AND m.author_id <> ${req.user!.id}
        AND m.created_at > COALESCE((SELECT r.last_read_at FROM ${chatReads} r WHERE r.channel_id = ${chatChannels.id} AND r.user_id = ${req.user!.id}), 'epoch')
    )`;
    return db
      .select({ id: chatChannels.id, name: chatChannels.name, description: chatChannels.description, clientId: chatChannels.clientId, unread })
      .from(chatChannels)
      .orderBy(asc(chatChannels.name));
  });

  app.post('/api/chat/channels', async (req, reply) => {
    const input = parse(channelInput, req.body);
    const name = input.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    const [row] = await db.insert(chatChannels).values({ ...input, name }).onConflictDoNothing().returning();
    if (!row) throw new HttpError(409, 'A channel with that name already exists');
    return reply.code(201).send(row);
  });

  app.get('/api/chat/channels/:id/messages', async (req) => {
    const { id } = parse(uuidParam, req.params);
    const { before } = parse(z.object({ before: z.string().datetime({ offset: true }).optional() }), req.query);
    const rows = await db
      .select({
        id: chatMessages.id, channelId: chatMessages.channelId, authorId: chatMessages.authorId, authorName: users.name,
        body: chatMessages.body, clientId: chatMessages.clientId, createdAt: chatMessages.createdAt,
      })
      .from(chatMessages)
      .innerJoin(users, eq(users.id, chatMessages.authorId))
      .where(and(eq(chatMessages.channelId, id), before ? lt(chatMessages.createdAt, before) : undefined))
      .orderBy(desc(chatMessages.createdAt))
      .limit(100);
    return rows.reverse();
  });

  app.post('/api/chat/channels/:id/messages', async (req, reply) => {
    const { id } = parse(uuidParam, req.params);
    const input = parse(chatMessageInput, req.body);
    const [row] = await db.insert(chatMessages).values({ channelId: id, authorId: req.user!.id, ...input }).returning();
    const message: ChatMessage = { ...row!, authorName: req.user!.name };
    await redis.publish(channels.chat, JSON.stringify(message));
    await markRead(id, req.user!.id);
    return reply.code(201).send(message);
  });

  app.post('/api/chat/channels/:id/read', async (req) => {
    const { id } = parse(uuidParam, req.params);
    await markRead(id, req.user!.id);
    return { ok: true };
  });

  /** Live feed of new messages across all channels (the practice is small; clients filter by channel). */
  app.get('/api/chat/ws', { websocket: true }, async (socket) => {
    const unsubscribe = await subscribe(channels.chat, (message) => {
      if (socket.readyState === socket.OPEN) socket.send(message);
    });
    const ping = setInterval(() => socket.ping(), 30_000);
    socket.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  });
}

async function markRead(channelId: string, userId: string) {
  const now = new Date().toISOString();
  await db
    .insert(chatReads)
    .values({ channelId, userId, lastReadAt: now })
    .onConflictDoUpdate({ target: [chatReads.channelId, chatReads.userId], set: { lastReadAt: now } });
}

