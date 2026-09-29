import path from 'node:path';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  DATA_DIR: z.string().default('./data'),
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Directory containing .claude-plugin/plugin.json and skills/<name>/SKILL.md. */
  AGENT_PLUGIN_DIR: z.string().default('../../agent'),
  AGENT_MODEL: z.string().default('claude-opus-5-5'),
  AGENT_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('high'),
  AGENT_MAX_TURNS: z.coerce.number().default(150),
  /** Hard spend cap per run, in USD. */
  AGENT_MAX_BUDGET_USD: z.coerce.number().default(15),
  /** Allow WebSearch/WebFetch (e.g. to check current product fees). Off by default. */
  AGENT_ALLOW_WEB: z.enum(['true', 'false']).default('false'),
  TOOL_RUN_CONCURRENCY: z.coerce.number().default(2),
  GRAPH_SYNC_EVERY_MINUTES: z.coerce.number().default(10),
});

export const env = schema.parse(process.env);
export const dataDir = path.resolve(env.DATA_DIR);
export const pluginDir = path.resolve(env.AGENT_PLUGIN_DIR);
