import type { FastifyInstance } from 'fastify';
import { computeOutcomes } from '../awards/service';
import { actorOf, sendError } from './http';

/**
 * Awards admin routes (SPEC I7) — registered INSIDE the token-guarded admin scope,
 * before the generic `/:resource` CRUD. The `awards` section falls through to the
 * ADMIN (40) default rank. Slice 1 exposes only the outcome computation (Community
 * Choice from the credibility-weighted vote; Critics' Choice auto-suggested,
 * staff-confirmed — insert-if-absent, so a staff override survives a re-run). The
 * full staff lifecycle (guarded phase transitions, publish/"turn it on", sponsor
 * slots, analytics) lands in Slice 2.
 */
export async function registerAwardAdminRoutes(admin: FastifyInstance): Promise<void> {
  admin.post<{ Params: { id: string } }>(
    '/awards/editions/:id/compute-outcomes',
    async (req, reply) => {
      try {
        const summary = await computeOutcomes(req.params.id, actorOf(req));
        reply.send({ data: summary });
      } catch (err) {
        sendError(reply, err);
      }
    },
  );
}
