import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { createDb } from '@tms/db';
import { QUEUES, type GraphSyncJob, type ToolRunJob } from '@tms/shared';
import { env } from './env';

export const { db, sql } = createDb(env.DATABASE_URL);

const connection = { url: env.REDIS_URL };
export const toolRunQueue = new Queue<ToolRunJob>(QUEUES.toolRuns, { connection });
export const graphSyncQueue = new Queue<GraphSyncJob>(QUEUES.graphSync, { connection });

export const redis = new Redis(env.REDIS_URL);

/**
 * One shared subscriber connection, fanned out to in-process listeners
 * (SSE streams for tool runs, chat websockets).
 */
const subscriber = new Redis(env.REDIS_URL);
const listeners = new Map<string, Set<(message: string) => void>>();
subscriber.on('message', (channel: string, message: string) => {
  for (const fn of listeners.get(channel) ?? []) fn(message);
});

export async function subscribe(channel: string, fn: (message: string) => void): Promise<() => void> {
  let set = listeners.get(channel);
  if (!set) {
    set = new Set();
    listeners.set(channel, set);
    await subscriber.subscribe(channel);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) {
      listeners.delete(channel);
      void subscriber.unsubscribe(channel);
    }
  };
}

export async function closeContext() {
  await Promise.allSettled([toolRunQueue.close(), graphSyncQueue.close(), redis.quit(), subscriber.quit(), sql.end()]);
}
