import type { FastifyInstance } from 'fastify';
import { getDashboard } from './dashboard';
import { sendError } from './http';

/**
 * Control Panel dashboard route (SPEC I8, Slice 1) — registered inside the
 * token/session-guarded admin scope. The `dashboard` section is gated at
 * MODERATOR (30) in `rbac.ts` so every staff role sees the overview; the figures
 * are aggregate/anonymous only.
 */
export async function registerDashboardRoutes(admin: FastifyInstance): Promise<void> {
  admin.get('/dashboard', async (_req, reply) => {
    try {
      reply.send({ data: await getDashboard() });
    } catch (err) {
      sendError(reply, err);
    }
  });
}
