import { Queue, Worker, type Job } from 'bullmq';
import { queueConnection } from '../queue/connection';
import { redis } from '../redis/client';
import { recomputeAllRatings, recomputeGameRating, type RecomputeResult } from './rating-engine';

/**
 * Rating-engine background job (SPEC I4b; CLAUDE.md "nothing heavy on user
 * request"). Aggregation + community weighting + disconnect run off the request
 * path on the worker and are stored — users read pre-computed summaries. The API
 * enqueues a full recompute on boot (demo); admin re-tunes/edits re-trigger it.
 * Idempotent + re-runnable.
 */
export const RATINGS_QUEUE = 'ratings';
export const RATINGS_JOB = 'recompute-ratings';
export const RATINGS_STATE_KEY = 'gameskeep:ratings:last-recompute';

export interface RatingJobData {
  reason?: string;
  /** Recompute a single game (after an edit); omit to recompute all. */
  gameId?: string;
}

export interface RatingRecomputeState extends RecomputeResult {
  reason: string;
  finishedAt: string;
}

let queue: Queue<RatingJobData> | null = null;

export function getRatingsQueue(): Queue<RatingJobData> {
  if (queue) return queue;
  queue = new Queue<RatingJobData>(RATINGS_QUEUE, { connection: queueConnection() });
  return queue;
}

export async function enqueueRatingRecompute(data: RatingJobData = {}): Promise<void> {
  const q = getRatingsQueue();
  await q.add(RATINGS_JOB, data, {
    removeOnComplete: 20,
    removeOnFail: 20,
    attempts: 3,
    backoff: { type: 'exponential', delay: 4000 },
  });
}

export function startRatingsWorker(): Worker<RatingJobData> {
  return new Worker<RatingJobData>(
    RATINGS_QUEUE,
    async (job: Job<RatingJobData>): Promise<RecomputeResult> => {
      if (job.data.gameId) {
        await recomputeGameRating(job.data.gameId);
        return { gamesProcessed: 1 };
      }
      const result = await recomputeAllRatings();
      const state: RatingRecomputeState = {
        ...result,
        reason: job.data.reason ?? 'manual',
        finishedAt: new Date().toISOString(),
      };
      await redis.set(RATINGS_STATE_KEY, JSON.stringify(state));
      return result;
    },
    { connection: queueConnection(), concurrency: 1 },
  );
}

export async function readRatingRecomputeState(): Promise<RatingRecomputeState | null> {
  const raw = await redis.get(RATINGS_STATE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RatingRecomputeState;
  } catch {
    return null;
  }
}
