import { Queue, Worker, type Job } from 'bullmq';
import { queueConnection } from '../queue/connection';
import { redis } from '../redis/client';
import { runIngest, type IngestOptions, type IngestResult } from './pipeline';
import { recomputeBias, type RecomputeResult } from './bias-engine';
import { recomputeHomepageQuietly } from '../homepage/jobs';
import { classifyArticles, recomputeTopicCategories } from '../news/categories';
import { requestSearchRefresh } from '../search/jobs';
import { seedS4Demo } from '../demo/s4-seed';

/**
 * Article-ingest background job (SPEC I3 §6; CLAUDE.md "nothing heavy on user
 * request"). The whole pull → embed → cluster → summarize flow runs off the
 * request path on the worker — exactly the I2 catalog-import pattern. The API
 * enqueues it on boot (demo); editors re-trigger (or re-cluster) it from admin.
 * Idempotent, so repeated runs never duplicate articles or splinter topics.
 */
export const ARTICLES_QUEUE = 'articles';
export const ARTICLES_INGEST_JOB = 'ingest-articles';
export const ARTICLES_STATE_KEY = 'gameskeep:articles:last-ingest';
export const BIAS_STATE_KEY = 'gameskeep:bias:last-recompute';

export interface ArticleJobData {
  reset?: boolean;
  skipIfPopulated?: boolean;
  limit?: number;
  reason?: string;
  /**
   * `bias` recomputes scores only (after a weight re-tune); `categories` re-runs the
   * news-category classifier + story categories (Phase P S4); default re-ingests.
   */
  mode?: 'ingest' | 'bias' | 'categories';
}

export interface BiasRecomputeState extends RecomputeResult {
  reason: string;
  finishedAt: string;
  /** BullMQ id of the job that wrote this state — lets a caller wait for ITS run. */
  jobId?: string;
}

export interface ArticleIngestState extends IngestResult {
  reason: string;
  finishedAt: string;
  /** BullMQ id of the job that wrote this state — lets a caller wait for ITS run. */
  jobId?: string;
}

let queue: Queue<ArticleJobData> | null = null;

export function getArticlesQueue(): Queue<ArticleJobData> {
  if (queue) return queue;
  queue = new Queue<ArticleJobData>(ARTICLES_QUEUE, { connection: queueConnection() });
  return queue;
}

/** Enqueue an ingest; returns the BullMQ job id (stamped into the state it writes). */
export async function enqueueArticleIngest(data: ArticleJobData = {}): Promise<string | undefined> {
  const q = getArticlesQueue();
  const job = await q.add(ARTICLES_INGEST_JOB, data, {
    removeOnComplete: 20,
    removeOnFail: 20,
    // Retry with backoff so a transient AI/DB hiccup at boot self-heals.
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
  });
  return job.id;
}

/** Phase P S4: re-run the news-category classifier (after a category / keyword / rule change). */
export async function enqueueReclassify(reason = 'manual'): Promise<string | undefined> {
  const job = await getArticlesQueue().add(
    ARTICLES_INGEST_JOB,
    { mode: 'categories', reason },
    {
      removeOnComplete: 20,
      removeOnFail: 20,
      attempts: 3,
      backoff: { type: 'exponential', delay: 3000 },
    },
  );
  return job.id;
}

/** Enqueue a bias-only recompute (after a weight re-tune) — off the request path. */
export async function enqueueBiasRecompute(reason = 'manual'): Promise<string | undefined> {
  const q = getArticlesQueue();
  const job = await q.add(
    ARTICLES_INGEST_JOB,
    { mode: 'bias', reason },
    {
      removeOnComplete: 20,
      removeOnFail: 20,
      attempts: 3,
      backoff: { type: 'exponential', delay: 3000 },
    },
  );
  return job.id;
}

export function startArticlesWorker(): Worker<ArticleJobData> {
  return new Worker<ArticleJobData>(
    ARTICLES_QUEUE,
    async (
      job: Job<ArticleJobData>,
    ): Promise<IngestResult | RecomputeResult | { articles: number; stories: number }> => {
      // Phase P S4: re-classify every article + recompute every story's category.
      if (job.data.mode === 'categories') {
        const changedArticles = await classifyArticles();
        const changedStories = await recomputeTopicCategories();
        await recomputeHomepageQuietly('categories');
        await requestSearchRefresh('categories');
        return { articles: changedArticles, stories: changedStories };
      }
      // Bias-only recompute (no re-ingest) — recomputes scores after a re-tune.
      if (job.data.mode === 'bias') {
        const result = await recomputeBias();
        const state: BiasRecomputeState = {
          ...result,
          reason: job.data.reason ?? 'manual',
          finishedAt: new Date().toISOString(),
          jobId: job.id,
        };
        await redis.set(BIAS_STATE_KEY, JSON.stringify(state));
        return result;
      }

      const options: IngestOptions = {
        reset: job.data.reset,
        skipIfPopulated: job.data.skipIfPopulated,
        limit: job.data.limit,
      };
      const result = await runIngest(options);
      // Phase P S4 (demo): the outlets exist now — seed any demo list still waiting for them.
      await seedS4Demo('ingest').catch(() => undefined);
      const state: ArticleIngestState = {
        ...result,
        reason: job.data.reason ?? 'manual',
        finishedAt: new Date().toISOString(),
        jobId: job.id,
      };
      await redis.set(ARTICLES_STATE_KEY, JSON.stringify(state));
      // An ingest also refreshed bias — reflect that in the bias state.
      await redis.set(
        BIAS_STATE_KEY,
        JSON.stringify({
          articlesScored: result.biasArticlesScored,
          topicsAggregated: result.totalTopics,
          reason: `ingest:${job.data.reason ?? 'manual'}`,
          finishedAt: new Date().toISOString(),
          jobId: job.id,
        } satisfies BiasRecomputeState),
      );
      // A re-cluster recreates topic rows — refresh the homepage snapshots before
      // this job reports done, so no snapshot points at a story that just went.
      await recomputeHomepageQuietly(`ingest:${job.data.reason ?? 'manual'}`);
      return result;
    },
    {
      connection: queueConnection(),
      // Embedding + clustering is sequential and AI-bound; one job at a time
      // keeps clustering deterministic and avoids racing the same feed twice.
      concurrency: 1,
    },
  );
}

export async function readArticleIngestState(): Promise<ArticleIngestState | null> {
  const raw = await redis.get(ARTICLES_STATE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ArticleIngestState;
  } catch {
    return null;
  }
}

export async function readBiasRecomputeState(): Promise<BiasRecomputeState | null> {
  const raw = await redis.get(BIAS_STATE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BiasRecomputeState;
  } catch {
    return null;
  }
}
