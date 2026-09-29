import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  /** Public origin of the portal, e.g. https://portal.brightday.com.au */
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  COOKIE_SECRET: z.string().min(32),
  DATA_DIR: z.string().default('./data'),
  SESSION_HOURS: z.coerce.number().default(12),
  /** Local development only: enables POST /auth/dev-login. Ignored in production. */
  DEV_LOGIN: z.enum(['true', 'false']).default('false'),
  /** First Microsoft sign-in with this address is created as an admin when no users exist. */
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  MAX_UPLOAD_MB: z.coerce.number().default(50),
});

export const env = schema.parse(process.env);
export const isProd = env.NODE_ENV === 'production';
export const devLoginEnabled = !isProd && env.DEV_LOGIN === 'true';
