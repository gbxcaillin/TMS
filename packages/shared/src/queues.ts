/** Queue names and payloads shared by the API (producer) and worker (consumer). */
export const QUEUES = {
  toolRuns: 'tool-runs',
  graphSync: 'graph-sync',
} as const;

export interface ToolRunJob { runId: string }
export interface GraphSyncJob { userId: string }

/** Redis pub/sub channels. */
export const channels = {
  run: (runId: string) => `run:${runId}`,
  chat: 'chat',
};
