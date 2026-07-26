import type { FastifyInstance } from 'fastify';
import {
  gameResolveInput,
  unmatchedDismiss,
  unmatchedResolveCreate,
  unmatchedResolveLink,
} from '@gameskeep/shared/validation';
import { enqueueCatalogImport, readCatalogImportState } from '../catalog/jobs';
import { getCatalogStats, listUpcomingGames } from '../catalog/queries';
import type { CleanGame } from '../catalog/normalize';
import {
  createGameForUnmatched,
  dismissUnmatched,
  linkUnmatched,
  resolveOrQueue,
  retryUnmatched,
} from '../catalog/resolve';
import { actorOf, sendError } from './http';

/**
 * Catalog + unmatched-queue admin routes (SPEC I2 §3/§4/§5/§6). Registered
 * INSIDE the token-guarded admin scope, before the generic `/:resource` CRUD so
 * these static/3-segment paths take precedence. Generic browse/edit/delete of
 * the queue still works via the `unmatched-games` resource; these add the
 * resolve workflow that a flat form can't express. Everything is audit-logged
 * (the resolve helpers write the audit rows).
 */
export async function registerCatalogAdminRoutes(admin: FastifyInstance): Promise<void> {
  // Catalog status: provider (mock/live), counts, last import result.
  admin.get('/catalog/status', async (_req, reply) => {
    try {
      const [stats, lastImport] = await Promise.all([getCatalogStats(), readCatalogImportState()]);
      reply.send({ ...stats, lastImport });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Upcoming subset (data only; the page is I5).
  admin.get('/catalog/upcoming', async (_req, reply) => {
    try {
      const data = await listUpcomingGames();
      reply.send({ data });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Re-run the import off the request path (idempotent). Returns immediately;
  // poll /catalog/status (lastImport.finishedAt) for completion.
  admin.post('/catalog/import', async (req, reply) => {
    try {
      const body = (req.body ?? {}) as { limit?: number };
      const limit =
        typeof body.limit === 'number' && body.limit > 0 ? Math.floor(body.limit) : undefined;
      await enqueueCatalogImport({ reason: 'manual', skipIfPopulated: false, limit });
      reply.code(202).send({ enqueued: true });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Resolve-or-queue a raw game reference (the path I3 will call). Demo resolves
  // against the mock dataset; production would query IGDB/RAWG live.
  admin.post('/game-resolve', async (req, reply) => {
    try {
      const { name, context } = gameResolveInput.parse(req.body);
      const outcome = await resolveOrQueue(name, context, actorOf(req));
      reply.send({ data: outcome });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Editor: link a queued reference to an existing game's Subject.
  admin.post('/unmatched-games/:id/resolve-link', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const { subjectId, note } = unmatchedResolveLink.parse(req.body);
      const ref = await linkUnmatched(id, subjectId, note, actorOf(req));
      if (!ref) {
        reply
          .code(400)
          .send({ error: 'bad_link', message: 'Unknown queue id or non-game subject' });
        return;
      }
      reply.send({ data: { status: 'resolved', ...ref } });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Editor: create a new game from a queued reference, then resolve the row.
  admin.post('/unmatched-games/:id/resolve-create', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const input = unmatchedResolveCreate.parse(req.body) as unknown as CleanGame;
      const ref = await createGameForUnmatched(id, input, actorOf(req));
      if (!ref) {
        reply.code(404).send({ error: 'not_found', message: 'Unknown queue id' });
        return;
      }
      reply.code(201).send({ data: { status: 'created', ...ref } });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Editor: re-attempt auto-resolution on a queued reference.
  admin.post('/unmatched-games/:id/retry', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const outcome = await retryUnmatched(id, actorOf(req));
      if (!outcome) {
        reply.code(404).send({ error: 'not_found', message: 'Unknown queue id' });
        return;
      }
      reply.send({ data: outcome });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Editor: dismiss a queued reference (not a game / spam / duplicate).
  admin.post('/unmatched-games/:id/dismiss', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const { note } = unmatchedDismiss.parse(req.body ?? {});
      const ok = await dismissUnmatched(id, note, actorOf(req));
      if (!ok) {
        reply.code(404).send({ error: 'not_found', message: 'Unknown queue id' });
        return;
      }
      reply.send({ data: { status: 'dismissed' } });
    } catch (err) {
      sendError(reply, err);
    }
  });
}
