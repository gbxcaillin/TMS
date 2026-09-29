import { ConfidentialClientApplication, type AuthenticationResult, type ICachePlugin } from '@azure/msal-node';
import { eq } from 'drizzle-orm';
import { msTokenCaches, type Db } from '@tms/db';
import { decrypt, encrypt } from './crypto';

/**
 * Delegated permissions requested at sign-in. Read-only by design: the portal
 * mirrors Outlook, it does not send mail or change calendars. Add Mail.Send /
 * Calendars.ReadWrite here (and in the Entra app registration) when needed.
 */
export const GRAPH_SCOPES = ['User.Read', 'Mail.Read', 'Calendars.Read'];
export const LOGIN_SCOPES = ['openid', 'profile', 'email', 'offline_access', ...GRAPH_SCOPES];

export interface MsalConfig {
  clientId: string;
  clientSecret: string;
  tenantId: string;
}

export function msalConfigFromEnv(): MsalConfig | null {
  const { MS_CLIENT_ID, MS_CLIENT_SECRET, MS_TENANT_ID } = process.env;
  if (!MS_CLIENT_ID || !MS_CLIENT_SECRET || !MS_TENANT_ID) return null;
  return { clientId: MS_CLIENT_ID, clientSecret: MS_CLIENT_SECRET, tenantId: MS_TENANT_ID };
}

/** Token cache persisted per portal user, encrypted at rest. */
function dbCachePlugin(db: Db, userId: string, onHomeAccount: (id: string) => string | null): ICachePlugin {
  return {
    async beforeCacheAccess(ctx) {
      const [row] = await db.select().from(msTokenCaches).where(eq(msTokenCaches.userId, userId));
      if (row) ctx.tokenCache.deserialize(decrypt(row.cipherText));
    },
    async afterCacheAccess(ctx) {
      if (!ctx.cacheHasChanged) return;
      const homeAccountId = onHomeAccount('');
      if (!homeAccountId) return;
      const cipherText = encrypt(ctx.tokenCache.serialize());
      await db
        .insert(msTokenCaches)
        .values({ userId, homeAccountId, cipherText })
        .onConflictDoUpdate({
          target: msTokenCaches.userId,
          set: { cipherText, homeAccountId, updatedAt: new Date().toISOString() },
        });
    },
  };
}

export function createMsalApp(cfg: MsalConfig, db?: Db, userId?: string, homeAccountId?: string) {
  let home = homeAccountId ?? null;
  const app = new ConfidentialClientApplication({
    auth: {
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
    },
    cache: db && userId ? { cachePlugin: dbCachePlugin(db, userId, () => home) } : undefined,
  });
  return {
    app,
    setHomeAccountId(id: string) {
      home = id;
    },
  };
}

export class GraphAuthError extends Error {}

/** Silent token for a user whose MSAL cache is stored in the DB. */
export async function getGraphToken(cfg: MsalConfig, db: Db, userId: string): Promise<string> {
  const [row] = await db.select().from(msTokenCaches).where(eq(msTokenCaches.userId, userId));
  if (!row) throw new GraphAuthError('Microsoft 365 is not connected for this user');
  const { app } = createMsalApp(cfg, db, userId, row.homeAccountId);
  const account = await app.getTokenCache().getAccountByHomeId(row.homeAccountId);
  if (!account) throw new GraphAuthError('Microsoft account missing from token cache; sign in again');
  let result: AuthenticationResult | null;
  try {
    result = await app.acquireTokenSilent({ account, scopes: GRAPH_SCOPES });
  } catch (err) {
    throw new GraphAuthError(`Silent token acquisition failed; sign in again (${(err as Error).message})`);
  }
  if (!result?.accessToken) throw new GraphAuthError('No access token returned');
  return result.accessToken;
}
