import type { FastifyInstance } from 'fastify';
import {
  articleReassignInput,
  clusterIngestInput,
  clusterSettingsUpdate,
  topicMergeInput,
  topicSplitInput,
} from '@gameskeep/shared/validation';
import { enqueueArticleIngest, readArticleIngestState } from '../articles/jobs';
import { getClusteringStats, listTopicsWithSources } from '../articles/queries';
import { getClusterSettings, setClusterSettings } from '../articles/settings';
import { mergeTopics, reassignArticle, splitTopic } from '../articles/merge-split';
import { actorOf, sendError } from './http';

/**
 * Clustering admin routes (SPEC I3 §4) — registered INSIDE the token-guarded
 * admin scope, before the generic `/:resource` CRUD so these static paths take
 * precedence. The generic browse/edit of `topics`/`articles` still works; these
 * add the engine controls a flat form can't express (tune, ingest/recluster,
 * merge, split, reassign). Topics + articles remain editable everywhere
 * (auto + manual override). Every mutation is audit-logged by the helpers.
 */
export async function registerArticleAdminRoutes(admin: FastifyInstance): Promise<void> {
  // Engine status: feed provider (mock/live), counts, settings, last ingest.
  admin.get('/clustering/status', async (_req, reply) => {
    try {
      const [stats, lastIngest] = await Promise.all([
        getClusteringStats(),
        readArticleIngestState(),
      ]);
      reply.send({ ...stats, lastIngest });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Topics with their articles + covering sources (the "did clustering work" view).
  admin.get('/clustering/topics', async (_req, reply) => {
    try {
      const data = await listTopicsWithSources();
      reply.send({ data });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Read clustering settings (threshold + window).
  admin.get('/clustering/settings', async (_req, reply) => {
    try {
      reply.send({ data: await getClusterSettings() });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Tune clustering settings (audit-logged). Re-cluster to see the effect.
  admin.patch('/clustering/settings', async (req, reply) => {
    try {
      const patch = clusterSettingsUpdate.parse(req.body);
      const next = await setClusterSettings(patch, actorOf(req));
      reply.send({ data: next });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Run the ingest off the request path. `reset` re-clusters the whole feed
  // (for tuning). Returns immediately; poll /clustering/status for completion.
  admin.post('/clustering/ingest', async (req, reply) => {
    try {
      const { reset } = clusterIngestInput.parse(req.body ?? {});
      await enqueueArticleIngest({ reason: reset ? 'recluster' : 'manual', reset });
      reply.code(202).send({ enqueued: true, reset });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Editor: merge one topic into another (engine wrongly split them).
  admin.post('/clustering/merge', async (req, reply) => {
    try {
      const { sourceTopicId, targetTopicId } = topicMergeInput.parse(req.body);
      const result = await mergeTopics(sourceTopicId, targetTopicId, actorOf(req));
      if (!result) {
        reply.code(404).send({ error: 'not_found', message: 'Unknown topic id(s)' });
        return;
      }
      reply.send({ data: result });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Editor: split selected articles out of a topic (engine wrongly lumped them).
  admin.post('/clustering/split', async (req, reply) => {
    try {
      const { topicId, articleIds, newTitle } = topicSplitInput.parse(req.body);
      const result = await splitTopic(topicId, articleIds, newTitle, actorOf(req));
      if (!result) {
        reply
          .code(400)
          .send({ error: 'bad_split', message: 'Unknown topic or no matching articles' });
        return;
      }
      reply.code(201).send({ data: result });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Editor: move an article to a different topic; optionally make it primary.
  admin.post('/clustering/reassign', async (req, reply) => {
    try {
      const { articleId, topicId, makePrimary } = articleReassignInput.parse(req.body);
      const ok = await reassignArticle(articleId, topicId, makePrimary, actorOf(req));
      if (!ok) {
        reply.code(404).send({ error: 'not_found', message: 'Unknown article or topic id' });
        return;
      }
      reply.send({ data: { status: 'reassigned', articleId, topicId, makePrimary } });
    } catch (err) {
      sendError(reply, err);
    }
  });
}
