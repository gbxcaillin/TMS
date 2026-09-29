import { eq } from 'drizzle-orm';
import { users } from '@tms/db';
import { GraphAuthError, getGraphToken, msalConfigFromEnv, syncCalendar, syncMailFolder } from '@tms/msgraph';
import { db } from './context';

export async function syncUser(userId: string, log: (msg: string) => void) {
  const cfg = msalConfigFromEnv();
  if (!cfg) return log('Microsoft 365 not configured; skipping sync');
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.active) return;
  let token: string;
  try {
    token = await getGraphToken(cfg, db, userId);
  } catch (err) {
    // Not connected or consent revoked: nothing to retry until the user signs in again.
    if (err instanceof GraphAuthError) return log(`${user.email}: ${err.message}`);
    throw err;
  }
  const cal = await syncCalendar(db, token, userId);
  const inbox = await syncMailFolder(db, token, userId, 'inbox');
  const sent = await syncMailFolder(db, token, userId, 'sentitems');
  log(`${user.email}: calendar +${cal.upserted}/-${cal.removed}, inbox +${inbox.upserted}/-${inbox.removed}, sent +${sent.upserted}/-${sent.removed}`);
}
