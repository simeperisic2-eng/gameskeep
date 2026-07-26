import type { FastifyInstance } from 'fastify';
import {
  burstFlagOverrideInput,
  disconnectTagInput,
  ratingOverrideInput,
  ratingSettingsUpdate,
} from '@gameskeep/shared/validation';
import { getRatingSettings, setRatingSettings } from '../ratings/rating-settings';
import {
  getGameRatingById,
  getGameVoteBreakdown,
  getRatingStatus,
  listGameRatings,
} from '../ratings/rating-queries';
import {
  setBurstFlagOverride,
  setDisconnectTag,
  setRatingOverride,
} from '../ratings/rating-engine';
import { enqueueRatingRecompute, readRatingRecomputeState } from '../ratings/jobs';
import { actorOf, sendError } from './http';

/**
 * Rating-engine admin routes (SPEC I4b) — registered INSIDE the token-guarded
 * admin scope, before the generic `/:resource` CRUD. The owner's tuning + trust
 * surface: inspect the three layers + disconnect + the per-vote weighting
 * breakdown ("no opaque number"), tune the weighting/burst/disconnect params,
 * override any computed value or the burst flag with an audited reason that a
 * re-tune won't clobber, and set the editor-only disconnect context tag. Heavy
 * recompute runs as a background job.
 */
export async function registerRatingAdminRoutes(admin: FastifyInstance): Promise<void> {
  admin.get('/ratings/status', async (_req, reply) => {
    try {
      const [status, lastRecompute] = await Promise.all([
        getRatingStatus(),
        readRatingRecomputeState(),
      ]);
      reply.send({ ...status, lastRecompute });
    } catch (err) {
      sendError(reply, err);
    }
  });

  admin.get('/ratings/settings', async (_req, reply) => {
    try {
      reply.send({ data: await getRatingSettings() });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Tune weighting/burst/disconnect (audit-logged) + auto-enqueue a recompute.
  admin.patch('/ratings/settings', async (req, reply) => {
    try {
      const patch = ratingSettingsUpdate.parse(req.body);
      const next = await setRatingSettings(patch, actorOf(req));
      await enqueueRatingRecompute({ reason: 'settings-changed' });
      reply.send({ data: next, recompute: 'enqueued' });
    } catch (err) {
      sendError(reply, err);
    }
  });

  admin.post('/ratings/recompute', async (req, reply) => {
    try {
      const body = (req.body ?? {}) as { gameId?: string };
      await enqueueRatingRecompute({ reason: 'manual', gameId: body.gameId });
      reply.code(202).send({ enqueued: true });
    } catch (err) {
      sendError(reply, err);
    }
  });

  admin.get('/ratings/games', async (req, reply) => {
    try {
      const q = req.query as { limit?: string };
      const limit = Math.min(Number(q.limit ?? 300) || 300, 1000);
      reply.send({ data: await listGameRatings(limit) });
    } catch (err) {
      sendError(reply, err);
    }
  });

  admin.get('/ratings/game/:id', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const row = await getGameRatingById(id);
      if (!row) {
        reply.code(404).send({ error: 'not_found' });
        return;
      }
      reply.send({ data: row });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // The per-vote weighting breakdown — how the community aggregate was formed.
  admin.get('/ratings/game/:id/votes', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      reply.send({ data: await getGameVoteBreakdown(id) });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Override the critics and/or community aggregate (auto kept underneath).
  admin.post('/ratings/game/:id/override', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const patch = ratingOverrideInput.parse(req.body);
      const ok = await setRatingOverride(id, patch, actorOf(req));
      if (!ok) {
        reply
          .code(404)
          .send({ error: 'not_found', message: 'No rating summary (recompute first)' });
        return;
      }
      reply.send({ data: await getGameRatingById(id) });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Force / clear the "unusual activity" burst flag (transparency override).
  admin.post('/ratings/game/:id/burst-flag', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const { flagged, reason } = burstFlagOverrideInput.parse(req.body);
      const ok = await setBurstFlagOverride(id, flagged, reason, actorOf(req));
      if (!ok) {
        reply.code(404).send({ error: 'not_found' });
        return;
      }
      reply.send({ data: await getGameRatingById(id) });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Editor-only disconnect context tag (the judgmental "why"; never auto).
  admin.post('/ratings/game/:id/disconnect-tag', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const { contextTag } = disconnectTagInput.parse(req.body);
      const ok = await setDisconnectTag(id, contextTag, actorOf(req));
      if (!ok) {
        reply.code(404).send({ error: 'not_found' });
        return;
      }
      reply.send({ data: await getGameRatingById(id) });
    } catch (err) {
      sendError(reply, err);
    }
  });
}
