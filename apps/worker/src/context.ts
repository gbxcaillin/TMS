import { Redis } from 'ioredis';
import { createDb, toolRunEvents } from '@tms/db';
import { channels, type ToolRunEvent } from '@tms/shared';
import { env } from './env';

export const { db, sql } = createDb(env.DATABASE_URL);
export const redis = new Redis(env.REDIS_URL);
export const connection = { url: env.REDIS_URL };

/** Persist a run event and push it to any open SSE streams. */
export async function emit(runId: string, kind: ToolRunEvent['kind'], message: string) {
  const [row] = await db.insert(toolRunEvents).values({ runId, kind, message: message.slice(0, 4000) }).returning();
  await redis.publish(channels.run(runId), JSON.stringify(row));
}
