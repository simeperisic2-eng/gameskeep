import { Queue, Worker, type Job } from 'bullmq';
import { queueConnection } from '../queue/connection';
import { redis } from '../redis/client';
import { runIngest, type IngestOptions, type IngestResult } from './pipeline';
import { recomputeBias, type RecomputeResult } from './bias-engine';

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
  /** `bias` recomputes scores only (after a weight re-tune); default re-ingests. */
  mode?: 'ingest' | 'bias';
}

export interface BiasRecomputeState extends RecomputeResult {
  reason: string;
  finishedAt: string;
}

export interface ArticleIngestState extends IngestResult {
  reason: string;
  finishedAt: string;
}

let queue: Queue<ArticleJobData> | null = null;

export function getArticlesQueue(): Queue<ArticleJobData> {
  if (queue) return queue;
  queue = new Queue<ArticleJobData>(ARTICLES_QUEUE, { connection: queueConnection() });
  return queue;
}

export async function enqueueArticleIngest(data: ArticleJobData = {}): Promise<void> {
  const q = getArticlesQueue();
  await q.add(ARTICLES_INGEST_JOB, data, {
    removeOnComplete: 20,
    removeOnFail: 20,
    // Retry with backoff so a transient AI/DB hiccup at boot self-heals.
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
  });
}

/** Enqueue a bias-only recompute (after a weight re-tune) — off the request path. */
export async function enqueueBiasRecompute(reason = 'manual'): Promise<void> {
  const q = getArticlesQueue();
  await q.add(
    ARTICLES_INGEST_JOB,
    { mode: 'bias', reason },
    {
      removeOnComplete: 20,
      removeOnFail: 20,
      attempts: 3,
      backoff: { type: 'exponential', delay: 3000 },
    },
  );
}

export function startArticlesWorker(): Worker<ArticleJobData> {
  return new Worker<ArticleJobData>(
    ARTICLES_QUEUE,
    async (job: Job<ArticleJobData>): Promise<IngestResult | RecomputeResult> => {
      // Bias-only recompute (no re-ingest) — recomputes scores after a re-tune.
      if (job.data.mode === 'bias') {
        const result = await recomputeBias();
        const state: BiasRecomputeState = {
          ...result,
          reason: job.data.reason ?? 'manual',
          finishedAt: new Date().toISOString(),
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
      const state: ArticleIngestState = {
        ...result,
        reason: job.data.reason ?? 'manual',
        finishedAt: new Date().toISOString(),
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
        } satisfies BiasRecomputeState),
      );
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
