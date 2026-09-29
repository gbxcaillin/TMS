import type { FastifyInstance } from 'fastify';
import { asc, eq } from 'drizzle-orm';
import { users } from '@tms/db';
import { z } from 'zod';
import { initials } from '../auth';
import { audit } from '../audit';
import { db } from '../context';
import { HttpError, notFound, parse, uuidParam } from '../http';

const roleSchema = z.enum(['adviser', 'paraplanner', 'admin', 'support']);

export async function userRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.requireUser);

  app.get('/api/me', async (req) => req.user);

  app.get('/api/users', async () => {
    const rows = await db.select().from(users).where(eq(users.active, true)).orderBy(asc(users.name));
    return rows.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, initials: initials(u.name) }));
  });

  /** Admins add staff; access is then granted on their first Microsoft sign-in. */
  app.post('/api/users', async (req, reply) => {
    if (req.user!.role !== 'admin') throw new HttpError(403, 'Admins only');
    const input = parse(z.object({ name: z.string().min(1).max(200), email: z.string().email(), role: roleSchema }), req.body);
    const [row] = await db.insert(users).values({ ...input, email: input.email.toLowerCase() }).onConflictDoNothing().returning();
    if (!row) throw new HttpError(409, 'User already exists');
    await audit(req, 'create', 'user', row.id, { email: row.email, role: row.role });
    return reply.code(201).send(row);
  });

  app.patch('/api/users/:id', async (req) => {
    if (req.user!.role !== 'admin') throw new HttpError(403, 'Admins only');
    const { id } = parse(uuidParam, req.params);
    const input = parse(z.object({ role: roleSchema.optional(), active: z.boolean().optional(), name: z.string().min(1).optional() }), req.body);
    const [row] = await db.update(users).set(input).where(eq(users.id, id)).returning();
    if (!row) throw notFound('User not found');
    await audit(req, 'update', 'user', id, input);
    return row;
  });
}
