import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { authPlugin } from './auth';
import { closeContext } from './context';
import { env, isProd } from './env';
import { HttpError } from './http';
import { chatRoutes } from './routes/chat';
import { clientRoutes } from './routes/clients';
import { dashboardRoutes } from './routes/dashboard';
import { outlookRoutes } from './routes/outlook';
import { taskRoutes } from './routes/tasks';
import { toolRoutes } from './routes/tools';
import { userRoutes } from './routes/users';

const app = Fastify({
  logger: { level: isProd ? 'info' : 'debug', redact: ['req.headers.cookie', 'req.headers.authorization'] },
  // Behind cloudflared: trust the tunnel's forwarded client IP.
  trustProxy: true,
  bodyLimit: 1024 * 1024,
});

app.setErrorHandler((err, req, reply) => {
  if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  if (status >= 500) req.log.error(err);
  return reply.code(status).send({ error: status >= 500 ? 'Internal server error' : (err as Error).message });
});

await app.register(cookie, { secret: env.COOKIE_SECRET });
await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
await app.register(multipart);
await app.register(websocket);
await app.register(authPlugin);
await app.register(userRoutes);
await app.register(dashboardRoutes);
await app.register(clientRoutes);
await app.register(taskRoutes);
await app.register(outlookRoutes);
await app.register(chatRoutes);
await app.register(toolRoutes);

app.get('/api/health', async () => ({ ok: true }));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    await closeContext();
    process.exit(0);
  });
}

await app.listen({ port: env.PORT, host: env.HOST });
