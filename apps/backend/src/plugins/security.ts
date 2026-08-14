import type { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { env } from '../config/env';
import { constantTimeEqual } from '../lib/crypto';

/**
 * Baseline security hardening (CLAUDE.md security rules): secure headers,
 * locked-down CORS, and login/abuse rate-limiting. Full auth/anti-abuse
 * lands in I6; this is the foundation it builds on.
 */
export async function registerSecurity(app: FastifyInstance): Promise<void> {
  // Secure HTTP headers. CSP is enforced on the frontend (where HTML is served);
  // the API returns JSON, so a strict CSP here would add no value.
  await app.register(helmet, { contentSecurityPolicy: false });

  // Only allow the configured frontend origin(s) to call the API.
  const origins = env.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  await app.register(cors, {
    origin: origins.length > 0 ? origins : false,
    credentials: true,
  });

  // Basic rate limit for ANONYMOUS traffic. Health probes are exempt (monitoring
  // never trips it), and so are token-authenticated admin/staff requests: the
  // admin API is already locked behind `x-admin-token` and audit-logged, and
  // legitimate bulk staff operations (user/catalog imports, rating recomputes)
  // must not be throttled like anonymous hits. Per-account login/abuse limits
  // arrive with real auth in I6 — that's where rate-limiting actually matters.
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    allowList: (req) => {
      if (req.url.startsWith('/health')) return true;
      const token = req.headers['x-admin-token'];
      const provided = Array.isArray(token) ? token[0] : token;
      // I6 hardening (LOW): constant-time here too — same secret, same rule.
      return Boolean(provided && constantTimeEqual(provided, env.ADMIN_API_TOKEN));
    },
  });
}
