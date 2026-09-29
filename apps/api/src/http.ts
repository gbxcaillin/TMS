import type { FastifyReply } from 'fastify';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, what);

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) throw new HttpError(400, z.prettifyError(result.error));
  return result.data;
}

export const uuidParam = z.object({ id: z.string().uuid() });

export function noContent(reply: FastifyReply) {
  return reply.code(204).send();
}
