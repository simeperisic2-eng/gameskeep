import type { FastifyInstance } from 'fastify';
import { adStatusInput } from '@gameskeep/shared/validation';
import { adAnalytics, inventory, setPlacementStatus } from '../ads/service';
import { actorOf, sendError } from './http';

/**
 * Ad / promotion admin routes (SPEC I8, Slice 2) — registered inside the
 * token/session-guarded admin scope, before the generic `/:resource` CRUD. The
 * `ads` section falls through to the ADMIN (40) default rank. Placements + slots
 * themselves are edited via the generic CRUD (`ad-placements`, `ad-slots`); these
 * add the revenue views (inventory, free-inventory, per-slot analytics) and the
 * manual activation switch (no payment gateway — status is admin-set).
 */
export async function registerAdAdminRoutes(admin: FastifyInstance): Promise<void> {
  // Inventory: every slot with its occupancy (active / scheduled / free).
  admin.get('/ads/inventory', async (_req, reply) => {
    try {
      reply.send({ data: await inventory() });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Per-slot aggregate analytics (impressions / clicks / occupancy).
  admin.get('/ads/analytics', async (_req, reply) => {
    try {
      reply.send({ data: await adAnalytics() });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Manual activation switch — set a placement's status after off-site payment.
  admin.post<{ Params: { id: string } }>('/ads/placements/:id/status', async (req, reply) => {
    try {
      const { status } = adStatusInput.parse(req.body);
      const result = await setPlacementStatus(req.params.id, status, actorOf(req));
      if (!result) {
        reply.code(404).send({ error: 'not_found', message: 'Unknown placement.' });
        return;
      }
      reply.send({ data: result });
    } catch (err) {
      sendError(reply, err);
    }
  });
}
