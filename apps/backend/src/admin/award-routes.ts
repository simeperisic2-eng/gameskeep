import type { FastifyInstance, FastifyReply } from 'fastify';
import { awardPhaseInput } from '@gameskeep/shared/validation';
import { AwardError, computeOutcomes, editionAnalytics, setEditionPhase } from '../awards/service';
import { actorOf, sendError } from './http';

/**
 * Awards admin routes (SPEC I7) — registered INSIDE the token-guarded admin scope,
 * before the generic `/:resource` CRUD. The `awards` section falls through to the
 * ADMIN (40) default rank. Slice 1 added the outcome computation; Slice 2 adds the
 * staff lifecycle: guarded phase transitions ("turn it on") and the aggregated,
 * leak-proof analytics view. Sponsor slots stay on the generic edition-category
 * CRUD (sponsorSlotLabel / sponsorSold). Public UI + archive are Slice 3.
 */
function sendAwardAdminError(reply: FastifyReply, err: unknown): void {
  if (err instanceof AwardError) {
    // phase_guard is a precondition failure (e.g. voting before publish/window).
    reply
      .code(err.code === 'phase_guard' ? 409 : 400)
      .send({ error: err.code, message: err.message });
    return;
  }
  sendError(reply, err);
}

export async function registerAwardAdminRoutes(admin: FastifyInstance): Promise<void> {
  // Compute + persist outcomes (Community Choice from the weighted vote; Critics'
  // Choice auto-suggested, staff-confirmed — insert-if-absent).
  admin.post<{ Params: { id: string } }>(
    '/awards/editions/:id/compute-outcomes',
    async (req, reply) => {
      try {
        reply.send({ data: await computeOutcomes(req.params.id, actorOf(req)) });
      } catch (err) {
        sendAwardAdminError(reply, err);
      }
    },
  );

  // Guarded phase transition (announce → nominations → voting → reveal → archive).
  // Opening `voting` requires publish + a window; entering `reveal` auto-decides.
  admin.post<{ Params: { id: string } }>('/awards/editions/:id/phase', async (req, reply) => {
    try {
      const { phase } = awardPhaseInput.parse(req.body);
      const result = await setEditionPhase(req.params.id, phase, actorOf(req));
      if (!result) {
        reply.code(404).send({ error: 'not_found', message: 'Unknown award edition.' });
        return;
      }
      reply.send({ data: result });
    } catch (err) {
      sendAwardAdminError(reply, err);
    }
  });

  // Aggregated, leak-proof analytics: voters, votes, subscribers, per-category
  // ratios + outcomes, votes-over-time (geo structurally present, empty in demo).
  admin.get<{ Params: { id: string } }>('/awards/editions/:id/analytics', async (req, reply) => {
    try {
      const data = await editionAnalytics(req.params.id);
      if (!data) {
        reply.code(404).send({ error: 'not_found', message: 'Unknown award edition.' });
        return;
      }
      reply.send({ data });
    } catch (err) {
      sendAwardAdminError(reply, err);
    }
  });
}
