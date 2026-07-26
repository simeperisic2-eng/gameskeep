import Fastify, { type FastifyInstance } from 'fastify';
import { env } from './config/env';
import { registerSecurity } from './plugins/security';
import { registerHealthRoutes } from './routes/health';
import { registerAdminRoutes } from './admin/routes';
import { registerPublicRoutes } from './public/routes';

/**
 * Build the Fastify app. Separated from the listen/boot logic so tests can
 * `inject` requests without opening a port.
 */
export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
    // Behind Cloudflare/Nginx later: trust the proxy for client IP + rate limit.
    trustProxy: true,
    // Reject oversized bodies early (anti-abuse / anti-bug).
    bodyLimit: 1_048_576, // 1 MiB
  });

  await registerSecurity(app);
  await registerHealthRoutes(app);
  await registerPublicRoutes(app);
  await registerAdminRoutes(app);

  // Friendly API root — confirms the foundation is serving.
  app.get('/', async () => ({
    name: 'GamesKeep API',
    status: 'ok',
    message: 'GamesKeep — foundation OK',
    mode: env.APP_MODE,
  }));

  return app;
}
