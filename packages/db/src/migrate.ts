import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { createDb } from './index';

const { db, sql } = createDb();
await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
await sql.end();
console.log('Migrations applied');
