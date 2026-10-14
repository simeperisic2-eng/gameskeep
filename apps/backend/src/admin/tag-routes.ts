import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  tagPublishDirectInput,
  tagResolveInput,
  tagSettingsPatch,
  tagSuggestionDecision,
} from '@gameskeep/shared/validation';
import {
  confirmGameTag,
  decideSuggestion,
  moderationQueue,
  publishDirect,
  reconfirmIssue,
  rejectGameTag,
  reopenGameTag,
  resolveIssue,
  TagError,
} from '../tags/service';
import { setTagSettings, tagSettings } from '../tags/settings';
import { enqueueHomepageCompute } from '../homepage/jobs';
import { enqueueTagSync } from '../tags/jobs';
import { actorOf, sendError } from './http';

/**
 * Tag moderation (Phase P S3). `/tag-queue` is MODERATOR rank (editors confirm,
 * publish, remove, resolve, decide suggestions); `/tag-settings` falls through
 * to ADMIN. The anomaly flag is always part of the queue rows. Every action is
 * audited in the service; a public change refreshes the homepage snapshots
 * (cards show tags).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(reply: FastifyReply, err: unknown): void {
  if (err instanceof TagError) {
    reply.code(err.status).send({ error: 'tags', message: err.message });
    return;
  }
  sendError(reply, err);
}
const refresh = async (reason: string): Promise<string | null> =>
  (await enqueueHomepageCompute({ reason }).catch(() => null)) ?? null;

export async function registerTagAdminRoutes(admin: FastifyInstance): Promise<void> {
  admin.get('/tag-queue', async (_req, reply) => {
    try {
      reply.send({ data: await moderationQueue() });
    } catch (err) {
      fail(reply, err);
    }
  });

  const action =
    (
      fn: (id: string, req: { body: unknown; actor: ReturnType<typeof actorOf> }) => Promise<void>,
    ) =>
    async (
      req: { params: { id: string }; body: unknown } & Parameters<typeof actorOf>[0],
      reply: FastifyReply,
    ): Promise<void> => {
      try {
        if (!UUID.test(req.params.id)) {
          reply.code(400).send({ error: 'bad_id', message: 'Invalid id.' });
          return;
        }
        await fn(req.params.id, { body: req.body, actor: actorOf(req) });
        reply.send({ ok: true, jobId: await refresh('tags') });
      } catch (err) {
        fail(reply, err);
      }
    };

  admin.post<{ Params: { id: string } }>(
    '/tag-queue/:id/confirm',
    action((id, r) => confirmGameTag(id, r.actor)),
  );
  admin.post<{ Params: { id: string } }>(
    '/tag-queue/:id/reject',
    action((id, r) => rejectGameTag(id, r.actor)),
  );
  admin.post<{ Params: { id: string } }>(
    '/tag-queue/:id/reopen',
    action((id, r) => reopenGameTag(id, r.actor)),
  );
  admin.post<{ Params: { id: string } }>(
    '/tag-queue/:id/reconfirm',
    action((id, r) => reconfirmIssue(id, r.actor)),
  );
  admin.post<{ Params: { id: string } }>(
    '/tag-queue/:id/resolve',
    action((id, r) => resolveIssue(id, tagResolveInput.parse(r.body ?? {}).patchRef, r.actor)),
  );

  // Re-run the import mapping (S3b: a background job — nothing heavy on the
  // request); returns the job id (GET /jobs/tags/:id for its state + result).
  admin.post('/tag-queue/sync', async (_req, reply) => {
    try {
      reply.code(202).send({ jobId: (await enqueueTagSync({ reason: 'admin' })) ?? null });
    } catch (err) {
      fail(reply, err);
    }
  });

  admin.post('/tag-queue/publish', async (req, reply) => {
    try {
      const input = tagPublishDirectInput.parse(req.body ?? {});
      const out = await publishDirect(input, actorOf(req));
      reply.code(201).send({ data: out, jobId: await refresh('tags') });
    } catch (err) {
      fail(reply, err);
    }
  });

  admin.post<{ Params: { id: string } }>('/tag-queue/suggestions/:id', async (req, reply) => {
    try {
      if (!UUID.test(req.params.id)) {
        reply.code(400).send({ error: 'bad_id', message: 'Invalid id.' });
        return;
      }
      const decision = tagSuggestionDecision.parse(req.body ?? {});
      const out = await decideSuggestion(req.params.id, decision, actorOf(req));
      reply.send({ data: out, jobId: await refresh('tags') });
    } catch (err) {
      fail(reply, err);
    }
  });

  admin.get('/tag-settings', async (_req, reply) => {
    try {
      reply.send({ data: await tagSettings() });
    } catch (err) {
      fail(reply, err);
    }
  });
  admin.patch('/tag-settings', async (req, reply) => {
    try {
      const patch = tagSettingsPatch.parse(req.body ?? {});
      reply.send({ data: await setTagSettings(patch, actorOf(req)), jobId: await refresh('tags') });
    } catch (err) {
      fail(reply, err);
    }
  });
}
