import { Queue, Worker, type Job } from 'bullmq';
import { queueConnection } from '../queue/connection';
import { redis } from '../redis/client';
import { recomputeAllReputation, type RecomputeReputationResult } from './engine';

/**
 * Reputation-engine background job (SPEC I6, Slice 5; CLAUDE.md "nothing heavy
 * on user request"). Reputation + level + auto-badges are recomputed off the
 * request path and stored — users read a pre-computed level/progress/badges.
 * Enqueued on boot; the admin re-trigger and (in a later pass) community events
 * re-fire it. Idempotent + re-runnable.
 */
export const REPUTATION_QUEUE = 'reputation';
export const REPUTATION_JOB = 'recompute-reputation';
export const REPUTATION_STATE_KEY = 'gameskeep:reputation:last-recompute';

export interface ReputationJobData {
  reason?: string;
}

export interface ReputationRecomputeState extends RecomputeReputationResult {
  reason: string;
  finishedAt: string;
}

let queue: Queue<ReputationJobData> | null = null;

export function getReputationQueue(): Queue<ReputationJobData> {
  if (queue) return queue;
  queue = new Queue<ReputationJobData>(REPUTATION_QUEUE, { connection: queueConnection() });
  return queue;
}

export async function enqueueReputationRecompute(data: ReputationJobData = {}): Promise<void> {
  const q = getReputationQueue();
  await q.add(REPUTATION_JOB, data, {
    removeOnComplete: 20,
    removeOnFail: 20,
    attempts: 3,
    backoff: { type: 'exponential', delay: 4000 },
  });
}

export function startReputationWorker(): Worker<ReputationJobData> {
  return new Worker<ReputationJobData>(
    REPUTATION_QUEUE,
    async (job: Job<ReputationJobData>): Promise<RecomputeReputationResult> => {
      const result = await recomputeAllReputation();
      const state: ReputationRecomputeState = {
        ...result,
        reason: job.data.reason ?? 'manual',
        finishedAt: new Date().toISOString(),
      };
      await redis.set(REPUTATION_STATE_KEY, JSON.stringify(state));
      return result;
    },
    { connection: queueConnection(), concurrency: 1 },
  );
}

export async function readReputationRecomputeState(): Promise<ReputationRecomputeState | null> {
  const raw = await redis.get(REPUTATION_STATE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ReputationRecomputeState;
  } catch {
    return null;
  }
}
