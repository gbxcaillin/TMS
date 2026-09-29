import type { FastifyRequest } from 'fastify';
import { auditLog } from '@tms/db';
import { db } from './context';

export async function audit(
  req: FastifyRequest,
  action: string,
  entity: string,
  entityId?: string | null,
  detail?: Record<string, unknown>,
) {
  await db.insert(auditLog).values({
    userId: req.user?.id ?? null,
    action,
    entity,
    entityId: entityId ?? null,
    detail: detail ?? null,
    ip: req.ip,
  });
}
