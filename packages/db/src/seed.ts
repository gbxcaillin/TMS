/** Seeds a development database with a practice, a few clients and channels. */
import { createDb, users, clients, chatChannels, tasks } from './index';

const { db, sql } = createDb();

const [adviser] = await db
  .insert(users)
  .values({ email: 'adviser@example.com', name: 'Alex Morgan', role: 'adviser' })
  .onConflictDoNothing()
  .returning();

if (!adviser) {
  console.log('Seed data already present');
  await sql.end();
  process.exit(0);
}

await db.insert(users).values([
  { email: 'paraplanner@example.com', name: 'Sam Lee', role: 'paraplanner' },
  { email: 'admin@example.com', name: 'Jordan Patel', role: 'admin' },
]);

const inserted = await db
  .insert(clients)
  .values([
    { name: 'Harper & Eli Nguyen', type: 'couple', emails: ['harper.nguyen@example.com', 'eli.nguyen@example.com'], adviserId: adviser.id, platform: 'HUB24', fum: 1_240_000, ongoingFee: 6600, reviewMonth: 10, nextReviewDate: '2026-10-14', ofaRenewalDate: '2026-11-01' },
    { name: 'Wilson Family SMSF', type: 'smsf', emails: ['trustee@wilsonsmsf.example.com'], adviserId: adviser.id, platform: 'Netwealth', fum: 2_150_000, ongoingFee: 9900, reviewMonth: 11, nextReviewDate: '2026-11-05', ofaRenewalDate: '2026-12-01' },
    { name: 'Priya Raman', type: 'individual', emails: ['priya.raman@example.com'], adviserId: adviser.id, platform: 'Macquarie Wrap', fum: 480_000, ongoingFee: 3850, reviewMonth: 10, nextReviewDate: '2026-10-22', ofaRenewalDate: '2026-10-30' },
  ])
  .returning();

await db.insert(chatChannels).values([
  { name: 'general', description: 'Practice-wide chat' },
  { name: 'paraplanning', description: 'Advice docs and file notes' },
  { name: 'admin', description: 'Ops, platforms and paperwork' },
]);

await db.insert(tasks).values([
  { title: 'Send OFA renewal to Priya', clientId: inserted[2]!.id, assigneeId: adviser.id, createdById: adviser.id, dueDate: '2026-10-10', priority: 'high' },
  { title: 'Collect SMSF bank statements', clientId: inserted[1]!.id, assigneeId: adviser.id, createdById: adviser.id, dueDate: '2026-10-15' },
]);

console.log('Seeded');
await sql.end();
