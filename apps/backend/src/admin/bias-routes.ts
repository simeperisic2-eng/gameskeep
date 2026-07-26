import type { FastifyInstance } from 'fastify';
import {
  biasInternalInput,
  biasNoteInput,
  biasOverrideInput,
  biasWeightsUpdate,
} from '@gameskeep/shared/validation';
import { getBiasWeights, setBiasWeights } from '../articles/bias-settings';
import {
  getArticleBiasAdmin,
  getArticleBiasPublic,
  getBiasStatus,
  listArticleBias,
  listTopicBias,
} from '../articles/bias-queries';
import {
  setArticleBiasOverride,
  setArticleEditorNote,
  setArticleInternalAssessment,
} from '../articles/bias-engine';
import { enqueueBiasRecompute } from '../articles/jobs';
import { actorOf, sendError } from './http';

/**
 * Bias-engine admin routes (SPEC I4a) — registered INSIDE the token-guarded admin
 * scope, before the generic `/:resource` CRUD. This is the owner's tuning + trust
 * surface: inspect every score's stored breakdown ("why"), tune the transparent
 * weights (nothing hardcoded), override any axis with an audited reason that a
 * re-tune won't clobber, write the editor's judgmental note, and edit the
 * internal-only assessment. Heavy work (recompute) runs as a background job; the
 * public payload route proves the internal field is structurally walled off.
 */
export async function registerBiasAdminRoutes(admin: FastifyInstance): Promise<void> {
  // Engine status: weights, gate, scored counts, last recompute.
  admin.get('/bias/status', async (_req, reply) => {
    try {
      reply.send(await getBiasStatus());
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Read the transparent additive weights.
  admin.get('/bias/weights', async (_req, reply) => {
    try {
      reply.send({ data: await getBiasWeights() });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Tune weights (audit-logged). Auto-enqueues a background recompute so the
  // re-tune lands on the stored scores without a second call.
  admin.patch('/bias/weights', async (req, reply) => {
    try {
      const patch = biasWeightsUpdate.parse(req.body);
      const next = await setBiasWeights(patch, actorOf(req));
      await enqueueBiasRecompute('weights-changed');
      reply.send({ data: next, recompute: 'enqueued' });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Recompute all scores off the request path (poll /bias/status for completion).
  admin.post('/bias/recompute', async (_req, reply) => {
    try {
      await enqueueBiasRecompute('manual');
      reply.code(202).send({ enqueued: true });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // List articles with their bias (auto/override/effective + stored breakdown).
  admin.get('/bias/articles', async (req, reply) => {
    try {
      const q = req.query as { limit?: string };
      const limit = Math.min(Number(q.limit ?? 500) || 500, 1000);
      reply.send({ data: await listArticleBias(limit) });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // One article (admin full view, includes the internal-only field).
  admin.get('/bias/article/:id', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const row = await getArticleBiasAdmin(id);
      if (!row) {
        reply.code(404).send({ error: 'not_found' });
        return;
      }
      reply.send({ data: row });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // The PUBLIC bias payload for one article — what I5 will render. Structurally
  // incapable of containing the internal-only field (allowlist serializer).
  admin.get('/bias/article/:id/public', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const row = await getArticleBiasPublic(id);
      if (!row) {
        reply.code(404).send({ error: 'not_found' });
        return;
      }
      reply.send({ data: row });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Editor override of an axis score (auto value retained underneath; audited).
  admin.post('/bias/article/:id/override', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const patch = biasOverrideInput.parse(req.body);
      const ok = await setArticleBiasOverride(id, patch, actorOf(req));
      if (!ok) {
        reply.code(404).send({ error: 'not_found' });
        return;
      }
      reply.send({ data: await getArticleBiasAdmin(id) });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Editor judgmental note (editor-entered only; never auto-generated).
  admin.post('/bias/article/:id/note', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const { editorNote } = biasNoteInput.parse(req.body);
      const ok = await setArticleEditorNote(id, editorNote, actorOf(req));
      if (!ok) {
        reply.code(404).send({ error: 'not_found' });
        return;
      }
      reply.send({ data: await getArticleBiasAdmin(id) });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Internal-only assessment (admin-scoped; never in any public payload).
  admin.post('/bias/article/:id/internal', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const { internalAssessment } = biasInternalInput.parse(req.body);
      const ok = await setArticleInternalAssessment(id, internalAssessment, actorOf(req));
      if (!ok) {
        reply.code(404).send({ error: 'not_found' });
        return;
      }
      reply.send({ data: await getArticleBiasAdmin(id) });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Topic-level bias distributions (the "bias bar" data for I5).
  admin.get('/bias/topics', async (_req, reply) => {
    try {
      reply.send({ data: await listTopicBias() });
    } catch (err) {
      sendError(reply, err);
    }
  });
}
