import { Queue, Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import { msTokenCaches, toolRuns } from '@tms/db';
import { QUEUES, type GraphSyncJob, type ToolRunJob } from '@tms/shared';
import { connection, db, redis, sql } from './context';
import { env, pluginDir } from './env';
import { syncUser } from './graph-sync';
import { runTool } from './runner';

const log = (msg: string) => console.log(`[worker] ${new Date().toISOString()} ${msg}`);

// A run still marked running at startup was interrupted by a restart (single worker deployment).
const orphaned = await db
  .update(toolRuns)
  .set({ status: 'failed', error: 'Interrupted by a worker restart; start the run again', finishedAt: new Date().toISOString() })
  .where(eq(toolRuns.status, 'running'))
  .returning({ id: toolRuns.id });
if (orphaned.length) log(`marked ${orphaned.length} interrupted run(s) as failed`);

const toolWorker = new Worker<ToolRunJob>(
  QUEUES.toolRuns,
  async (job) => {
    log(`tool run ${job.data.runId} starting`);
    await runTool(job.data.runId);
    log(`tool run ${job.data.runId} finished`);
  },
  // Agent runs are long; keep the lock alive well past the default.
  { connection, concurrency: env.TOOL_RUN_CONCURRENCY, lockDuration: 10 * 60_000 },
);

const syncWorker = new Worker<GraphSyncJob & { all?: boolean }>(
  QUEUES.graphSync,
  async (job) => {
    if (job.name === 'sync-all') {
      const rows = await db.select({ userId: msTokenCaches.userId }).from(msTokenCaches);
      for (const { userId } of rows) await syncQueue.add('sync', { userId }, { jobId: `sync-${userId}-${Date.now()}` });
      return;
    }
    await syncUser(job.data.userId, log);
  },
  { connection, concurrency: 2 },
);

const syncQueue = new Queue(QUEUES.graphSync, { connection });
await syncQueue.upsertJobScheduler(
  'sync-all-users',
  { every: env.GRAPH_SYNC_EVERY_MINUTES * 60_000 },
  { name: 'sync-all', data: { userId: '' }, opts: { removeOnComplete: 100, removeOnFail: 100 } },
);

for (const w of [toolWorker, syncWorker]) {
  w.on('failed', (job, err) => log(`job ${job?.name} ${job?.id} failed: ${err.message}`));
}

log(`ready (skills from ${pluginDir}, model ${env.AGENT_MODEL})`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    log('shutting down');
    await Promise.allSettled([toolWorker.close(), syncWorker.close(), syncQueue.close()]);
    await Promise.allSettled([redis.quit(), sql.end()]);
    process.exit(0);
  });
}
