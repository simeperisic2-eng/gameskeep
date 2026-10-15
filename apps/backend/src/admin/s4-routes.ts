import type { FastifyInstance, FastifyReply } from 'fastify';
import { asc, desc, sql } from 'drizzle-orm';
import {
  editorialListDecision,
  editorialListEntriesInput,
  editorialListEntryMatch,
  editorialListInput,
  editorialListUpdate,
} from '@gameskeep/shared/validation';
import { db } from '../db/client';
import {
  adminConsensus,
  consensusPairs,
  createList,
  decideList,
  getListAdmin,
  listCategories,
  listLexicon,
  ListError,
  listQueue,
  matchEntry,
  setListEntries,
  setListLexicon,
  updateList,
} from '../lists/service';
import { enqueueConsensus } from '../lists/jobs';
import { enqueueReclassify } from '../articles/jobs';
import { newsCategories as newsCategoryTable } from '../db/schema';
import { enqueueSearchRebuild } from '../search/jobs';
import { searchTest } from '../search/query';
import { actorOf, sendError } from './http';

/**
 * Phase P S4 admin surfaces.
 *  - `editorial-lists` (MODERATOR — editors): the candidate queue, the list
 *    editor (metadata, pasted entries, per-entry matching), the consensus
 *    preview, the detection phrases, a recompute job.
 *  - `news` (ADMIN): category counts + the reclassify job (the categories
 *    themselves are the generic `news-categories` resource).
 *  - `search` (ADMIN): a test query showing the ranking + the reindex job.
 * Heavy work always runs as a background job that returns its id.
 */
function fail(reply: FastifyReply, err: unknown): void {
  if (err instanceof ListError) {
    reply
      .code(err.status)
      .send({ error: err.status === 404 ? 'not_found' : 'invalid', message: err.message });
    return;
  }
  sendError(reply, err);
}

export async function registerS4AdminRoutes(admin: FastifyInstance): Promise<void> {
  // ── editorial lists ─────────────────────────────────────────────────────────
  admin.get('/editorial-lists/queue', async (_req, reply) => {
    try {
      const [queue, categories, pairs] = await Promise.all([
        listQueue(),
        listCategories(false),
        consensusPairs(),
      ]);
      reply.send({ data: { ...queue, categories, pairs } });
    } catch (err) {
      fail(reply, err);
    }
  });

  admin.get('/editorial-lists/lexicon', async (_req, reply) => {
    try {
      reply.send({ data: await listLexicon() });
    } catch (err) {
      fail(reply, err);
    }
  });
  admin.put('/editorial-lists/lexicon', async (req, reply) => {
    try {
      reply.send({ data: await setListLexicon(req.body, actorOf(req)) });
    } catch (err) {
      fail(reply, err);
    }
  });

  admin.get<{ Params: { year: string; category: string } }>(
    '/editorial-lists/consensus/:year/:category',
    async (req, reply) => {
      try {
        const year = Number.parseInt(req.params.year, 10);
        if (!Number.isInteger(year)) throw new ListError(400, 'Bad year.');
        reply.send({ data: await adminConsensus(year, String(req.params.category)) });
      } catch (err) {
        fail(reply, err);
      }
    },
  );

  admin.post('/editorial-lists/recompute', async (_req, reply) => {
    try {
      reply.code(202).send({ jobId: (await enqueueConsensus({ reason: 'admin' })) ?? null });
    } catch (err) {
      fail(reply, err);
    }
  });

  admin.post('/editorial-lists', async (req, reply) => {
    try {
      const input = editorialListInput.parse(req.body ?? {});
      reply.code(201).send({ data: await createList(input, actorOf(req)) });
    } catch (err) {
      fail(reply, err);
    }
  });

  admin.get<{ Params: { id: string } }>('/editorial-lists/:id', async (req, reply) => {
    try {
      reply.send({ data: await getListAdmin(req.params.id) });
    } catch (err) {
      fail(reply, err);
    }
  });

  admin.patch<{ Params: { id: string } }>('/editorial-lists/:id', async (req, reply) => {
    try {
      const patch = editorialListUpdate.parse(req.body ?? {});
      const confirmed = await updateList(req.params.id, patch, actorOf(req));
      const jobId = confirmed ? await enqueueConsensus({ reason: 'list-edit' }) : null;
      reply.send({ ok: true, jobId: jobId ?? null });
    } catch (err) {
      fail(reply, err);
    }
  });

  admin.post<{ Params: { id: string } }>('/editorial-lists/:id/decision', async (req, reply) => {
    try {
      const { status, note } = editorialListDecision.parse(req.body ?? {});
      await decideList(req.params.id, status, note, actorOf(req));
      reply.send({
        ok: true,
        jobId: (await enqueueConsensus({ reason: `list-${status}` })) ?? null,
      });
    } catch (err) {
      fail(reply, err);
    }
  });

  admin.put<{ Params: { id: string } }>('/editorial-lists/:id/entries', async (req, reply) => {
    try {
      const { text } = editorialListEntriesInput.parse(req.body ?? {});
      const out = await setListEntries(req.params.id, text, actorOf(req));
      const jobId = out.confirmed ? await enqueueConsensus({ reason: 'list-entries' }) : null;
      reply.send({ data: out, jobId: jobId ?? null });
    } catch (err) {
      fail(reply, err);
    }
  });

  admin.post<{ Params: { entryId: string } }>(
    '/editorial-lists/entries/:entryId/match',
    async (req, reply) => {
      try {
        const input = editorialListEntryMatch.parse(req.body ?? {});
        const out = await matchEntry(req.params.entryId, input, actorOf(req));
        const jobId = out.confirmed ? await enqueueConsensus({ reason: 'list-match' }) : null;
        reply.send({ ok: true, jobId: jobId ?? null });
      } catch (err) {
        fail(reply, err);
      }
    },
  );

  // ── news categories ─────────────────────────────────────────────────────────
  admin.get('/news/overview', async (_req, reply) => {
    try {
      // Every category (inactive ones too, so they can be re-enabled), with its id for the editor link.
      const cats = await db
        .select({
          id: newsCategoryTable.id,
          key: newsCategoryTable.key,
          label: newsCategoryTable.label,
          mode: newsCategoryTable.mode,
          keywords: newsCategoryTable.keywords,
          priority: newsCategoryTable.priority,
          active: newsCategoryTable.active,
        })
        .from(newsCategoryTable)
        .orderBy(desc(newsCategoryTable.priority), asc(newsCategoryTable.key));
      const res = await db.execute(sql`
        SELECT k, sum(articles)::int AS articles, sum(stories)::int AS stories FROM (
          SELECT coalesce(category_override, category, 'news') AS k, count(*) AS articles, 0 AS stories
            FROM articles GROUP BY 1
          UNION ALL
          SELECT coalesce(category, 'news') AS k, 0, count(*)
            FROM topics WHERE bias_distribution IS NOT NULL GROUP BY 1
        ) x GROUP BY k
      `);
      const rows = ((
        res as unknown as { rows?: { k: string; articles: number; stories: number }[] }
      ).rows ?? (res as unknown as { k: string; articles: number; stories: number }[])) as {
        k: string;
        articles: number;
        stories: number;
      }[];
      const counts = new Map(rows.map((r) => [r.k, r]));
      reply.send({
        data: cats.map((c) => ({
          ...c,
          articles: counts.get(c.key)?.articles ?? 0,
          stories: counts.get(c.key)?.stories ?? 0,
        })),
      });
    } catch (err) {
      fail(reply, err);
    }
  });

  admin.post('/news/reclassify', async (_req, reply) => {
    try {
      reply.code(202).send({ jobId: (await enqueueReclassify('admin')) ?? null });
    } catch (err) {
      fail(reply, err);
    }
  });

  // ── search ──────────────────────────────────────────────────────────────────
  admin.get<{ Querystring: { q?: unknown } }>('/search/test', async (req, reply) => {
    try {
      reply.send({ data: await searchTest(req.query?.q) });
    } catch (err) {
      fail(reply, err);
    }
  });

  admin.post('/search/reindex', async (_req, reply) => {
    try {
      reply.code(202).send({ jobId: (await enqueueSearchRebuild({ reason: 'admin' })) ?? null });
    } catch (err) {
      fail(reply, err);
    }
  });
}
