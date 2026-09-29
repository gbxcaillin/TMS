import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, count, eq, gt, or } from 'drizzle-orm';
import { CryptoProvider } from '@azure/msal-node';
import { msTokenCaches, sessions, users } from '@tms/db';
import { LOGIN_SCOPES, createMsalApp, encrypt, msalConfigFromEnv, sha256 } from '@tms/msgraph';
import type { Role, User } from '@tms/shared';
import { db, graphSyncQueue } from './context';
import { devLoginEnabled, env, isProd } from './env';
import { HttpError } from './http';

export const SESSION_COOKIE = 'tms_session';
const OAUTH_COOKIE = 'tms_oauth';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
  }
  interface FastifyInstance {
    requireUser: (req: FastifyRequest) => Promise<void>;
  }
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

const callbackUrl = () => `${env.WEB_ORIGIN}/api/auth/microsoft/callback`;

const cookieBase = { path: '/', httpOnly: true, secure: isProd, sameSite: 'lax' as const };

async function createSession(req: FastifyRequest, reply: FastifyReply, userId: string) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + env.SESSION_HOURS * 3_600_000);
  await db.insert(sessions).values({
    tokenHash: sha256(token),
    userId,
    expiresAt: expires.toISOString(),
    ip: req.ip,
    userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
  });
  reply.setCookie(SESSION_COOKIE, token, { ...cookieBase, expires });
}

async function loadUser(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const [row] = await db
    .select({ user: users, cacheUser: msTokenCaches.userId })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(msTokenCaches, eq(msTokenCaches.userId, users.id))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date().toISOString())));
  if (!row || !row.user.active) return null;
  const u = row.user;
  return { id: u.id, name: u.name, email: u.email, role: u.role as Role, initials: initials(u.name), msConnected: !!row.cacheUser };
}

export async function authPlugin(app: FastifyInstance) {
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req) => {
    req.user = await loadUser(req.cookies[SESSION_COOKIE]);
    // CSRF: state-changing requests must come from the portal's own origin.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin && origin !== env.WEB_ORIGIN) throw new HttpError(403, 'Cross-origin request blocked');
    }
  });

  app.decorate('requireUser', async (req: FastifyRequest) => {
    if (!req.user) throw new HttpError(401, 'Not signed in');
  });

  app.get('/api/auth/microsoft/login', async (_req, reply) => {
    const cfg = msalConfigFromEnv();
    if (!cfg) throw new HttpError(503, 'Microsoft sign-in is not configured (MS_CLIENT_ID / MS_CLIENT_SECRET / MS_TENANT_ID)');
    const crypto = new CryptoProvider();
    const { verifier, challenge } = await crypto.generatePkceCodes();
    const state = crypto.createNewGuid();
    const { app: msal } = createMsalApp(cfg);
    const url = await msal.getAuthCodeUrl({
      scopes: LOGIN_SCOPES,
      redirectUri: callbackUrl(),
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      state,
      prompt: 'select_account',
    });
    reply.setCookie(OAUTH_COOKIE, JSON.stringify({ state, verifier }), { ...cookieBase, signed: true, maxAge: 600 });
    return reply.redirect(url);
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>(
    '/api/auth/microsoft/callback',
    async (req, reply) => {
      const cfg = msalConfigFromEnv();
      if (!cfg) throw new HttpError(503, 'Microsoft sign-in is not configured');
      const fail = (reason: string) => reply.redirect(`${env.WEB_ORIGIN}/login?error=${encodeURIComponent(reason)}`);
      if (req.query.error) return fail(req.query.error_description ?? req.query.error);

      const raw = req.cookies[OAUTH_COOKIE];
      const unsigned = raw ? req.unsignCookie(raw) : null;
      reply.clearCookie(OAUTH_COOKIE, { path: '/' });
      if (!unsigned?.valid || !unsigned.value) return fail('Sign-in session expired, please try again');
      const { state, verifier } = JSON.parse(unsigned.value) as { state: string; verifier: string };
      if (!req.query.code || req.query.state !== state) return fail('Invalid sign-in response');

      const { app: exchange } = createMsalApp(cfg);
      const result = await exchange.acquireTokenByCode({
        code: req.query.code,
        codeVerifier: verifier,
        redirectUri: callbackUrl(),
        scopes: LOGIN_SCOPES,
      });
      const claims = result.idTokenClaims as { oid?: string; preferred_username?: string; email?: string; name?: string };
      const email = (claims.email ?? claims.preferred_username ?? '').toLowerCase();
      if (!claims.oid || !email || !result.account) return fail('Microsoft did not return an account');

      let [user] = await db.select().from(users).where(or(eq(users.msOid, claims.oid), eq(users.email, email)));
      if (!user) {
        const [{ n }] = (await db.select({ n: count() }).from(users)) as [{ n: number }];
        if (n === 0 && env.BOOTSTRAP_ADMIN_EMAIL?.toLowerCase() === email) {
          [user] = await db.insert(users).values({ email, name: claims.name ?? email, role: 'admin', msOid: claims.oid }).returning();
        }
      }
      // Portal access is limited to staff an admin has added.
      if (!user || !user.active) return fail(`${email} does not have access to the portal. Ask an administrator to add you.`);
      if (user.msOid !== claims.oid) await db.update(users).set({ msOid: claims.oid }).where(eq(users.id, user.id));

      // Persist the MSAL cache (holds the refresh token) so the worker can sync Outlook in the background.
      const homeAccountId = result.account.homeAccountId;
      const cipherText = encrypt(exchange.getTokenCache().serialize());
      await db
        .insert(msTokenCaches)
        .values({ userId: user.id, homeAccountId, cipherText })
        .onConflictDoUpdate({ target: msTokenCaches.userId, set: { homeAccountId, cipherText, updatedAt: new Date().toISOString() } });

      await createSession(req, reply, user.id);
      await graphSyncQueue.add('sync', { userId: user.id }, { jobId: `sync-${user.id}-${Date.now()}` });
      return reply.redirect(`${env.WEB_ORIGIN}/`);
    },
  );

  app.post<{ Body: { email?: string } }>('/api/auth/dev-login', async (req, reply) => {
    if (!devLoginEnabled) throw new HttpError(404, 'Not found');
    const email = (req.body?.email ?? '').toLowerCase();
    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user) throw new HttpError(404, 'No such user (run npm run db:seed)');
    await createSession(req, reply, user.id);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/config', async () => ({ microsoft: !!msalConfigFromEnv(), devLogin: devLoginEnabled }));
}

// Hooks and decorators above must apply to every route, not just this plugin's scope.
(authPlugin as unknown as Record<symbol, boolean>)[Symbol.for('skip-override')] = true;
