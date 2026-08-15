import type { FastifyInstance } from 'fastify';
import { enqueueReputationRecompute, readReputationRecomputeState } from '../reputation/jobs';
import { getReputationBreakdown } from '../reputation/engine';
import { sendError } from './http';

/**
 * Reputation-engine admin surface (SPEC I6, Slice 5). Section `reputation` is
 * gated at ADMIN rank (admin/rbac.ts). Staff MAY see the reputation breakdown —
 * the transparency the public never gets (decision 11: users see only level +
 * progress + badges). Registered under the admin scope, before the generic CRUD.
 */
export async function registerReputationAdminRoutes(admin: FastifyInstance): Promise<void> {
  // Trigger a full recompute (heavy → background job).
  admin.post('/reputation/recompute', async (req, reply) => {
    try {
      const body = (req.body ?? {}) as { reason?: string };
      await enqueueReputationRecompute({ reason: body.reason ?? 'admin' });
      reply.code(202).send({ ok: true, status: 'enqueued' });
    } catch (err) {
      sendError(reply, err);
    }
  });

  admin.get('/reputation/status', async (_req, reply) => {
    try {
      reply.send({ data: await readReputationRecomputeState() });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Staff-only breakdown of one user's reputation (the "why" behind the number).
  admin.get<{ Params: { id: string } }>('/reputation/user/:id', async (req, reply) => {
    try {
      const breakdown = await getReputationBreakdown(req.params.id);
      if (!breakdown) {
        reply.code(404).send({ error: 'not_found' });
        return;
      }
      reply.send({ data: breakdown });
    } catch (err) {
      sendError(reply, err);
    }
  });
}
