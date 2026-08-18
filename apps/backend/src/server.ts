import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { env, trustProxyValue } from './config/env';
import { registerSecurity } from './plugins/security';
import { registerHealthRoutes } from './routes/health';
import { registerAdminRoutes } from './admin/routes';
import { registerAuthRoutes } from './auth/routes';
import { registerCommunityRoutes } from './community/routes';
import { registerAwardRoutes } from './awards/routes';
import { registerPublicRoutes } from './public/routes';

/**
 * Build the Fastify app. Separated from the listen/boot logic so tests can
 * `inject` requests without opening a port.
 */
export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
    // I6 hardening (HIGH): default FALSE — req.ip is the unspoofable socket
    // peer and X-Forwarded-For is ignored, so per-IP throttles can't be
    // defeated by a forged header. Production behind a real proxy sets
    // TRUST_PROXY to a hop count / CIDR list (see config/env.ts).
    trustProxy: trustProxyValue(),
    // Reject oversized bodies early (anti-abuse / anti-bug).
    bodyLimit: 1_048_576, // 1 MiB
  });

  // Signed cookies for the I6 session (HttpOnly; the secret never leaves env).
  await app.register(fastifyCookie, { secret: env.SESSION_SECRET });

  await registerSecurity(app);
  await registerHealthRoutes(app);
  await registerPublicRoutes(app);
  await registerAuthRoutes(app);
  await registerCommunityRoutes(app);
  await registerAwardRoutes(app);
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
