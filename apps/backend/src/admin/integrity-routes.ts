import type { FastifyInstance } from 'fastify';
import { integrityDecisionInput, integritySignalInput } from '@gameskeep/shared/validation';
import { addOrConfirmSignal, decideSignal, listReviewIntegrity } from '../articles/integrity';
import { enqueueArticleIngest } from '../articles/jobs';
import { displaySettings } from '../display/settings';
import { actorOf, sendError } from './http';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Review-integrity moderation (Phase P S1) — section `integrity`, MODERATOR (30)
 * and above ("Editor" in the spec). Moderators review auto-detected signals,
 * confirm or dismiss them, and add their own with a note + date. While
 * `integrity.autoPublish` is off (default) only confirmed rows are public.
 * Every decision is audited (entity `article-integrity`).
 */
export async function registerIntegrityAdminRoutes(admin: FastifyInstance): Promise<void> {
  admin.get('/integrity/reviews', async (req, reply) => {
    try {
      const q = req.query as { limit?: string };
      const limit = Number.parseInt(q.limit ?? '200', 10);
      const [reviews, settings] = await Promise.all([
        listReviewIntegrity(Number.isFinite(limit) ? limit : 200),
        displaySettings(),
      ]);
      reply.send({ data: { reviews, autoPublish: settings.integrityAutoPublish } });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Add a signal to a review (or confirm the existing one of that kind).
  admin.post<{ Params: { id: string } }>('/integrity/articles/:id/signals', async (req, reply) => {
    try {
      if (!UUID_RE.test(req.params.id)) {
        reply.code(404).send({ error: 'not_found' });
        return;
      }
      const input = integritySignalInput.parse(req.body);
      const result = await addOrConfirmSignal(req.params.id, input, actorOf(req));
      if (result === 'not_found') {
        reply.code(404).send({ error: 'not_found' });
        return;
      }
      if (result === 'not_review') {
        reply.code(409).send({
          error: 'not_review',
          message: 'Integrity signals apply to review articles only.',
        });
        return;
      }
      reply.code(201).send({ data: result });
    } catch (err) {
      sendError(reply, err);
    }
  });

  for (const action of ['confirm', 'dismiss'] as const) {
    admin.post<{ Params: { id: string } }>(
      `/integrity/signals/:id/${action}`,
      async (req, reply) => {
        try {
          if (!UUID_RE.test(req.params.id)) {
            reply.code(404).send({ error: 'not_found' });
            return;
          }
          const { note } = integrityDecisionInput.parse(req.body ?? {});
          const status = action === 'confirm' ? 'confirmed' : 'dismissed';
          const result = await decideSignal(req.params.id, status, note, actorOf(req));
          if (!result) {
            reply.code(404).send({ error: 'not_found' });
            return;
          }
          reply.send({ data: result });
        } catch (err) {
          sendError(reply, err);
        }
      },
    );
  }

  // Re-scan the feed for disclosure evidence (an ordinary, idempotent ingest).
  admin.post('/integrity/rescan', async (_req, reply) => {
    try {
      const jobId = await enqueueArticleIngest({ reason: 'integrity-rescan' });
      reply.code(202).send({ enqueued: true, jobId: jobId ?? null });
    } catch (err) {
      sendError(reply, err);
    }
  });
}
