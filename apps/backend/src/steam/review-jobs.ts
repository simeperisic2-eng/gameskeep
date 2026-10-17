import { Queue, Worker, type Job } from 'bullmq';
import { queueConnection } from '../queue/connection';
import { rulesSettings } from '../rules/settings';
import { runSteamReviewSummaries } from './review-summary';

/**
 * The Steam reviews summary job (Phase P S5) — weekly by default (admin rule
 * `steamReviews.intervalDays`), plus a run at boot and an admin "Run now" that
 * returns its job id. Demo: mock reviews, no network.
 */
export const STEAM_REVIEWS_QUEUE = 'steam-reviews';
export const STEAM_REVIEWS_JOB = 'summarise-steam-reviews';
const SCHEDULED_JOB = 'summarise-steam-reviews-scheduled';

export interface SteamReviewsJobData {
  reason?: string;
}

let queue: Queue<SteamReviewsJobData> | null = null;

export function getSteamReviewsQueue(): Queue<SteamReviewsJobData> {
  if (queue) return queue;
  queue = new Queue<SteamReviewsJobData>(STEAM_REVIEWS_QUEUE, { connection: queueConnection() });
  return queue;
}

export async function enqueueSteamSummaries(reason = 'manual'): Promise<string | undefined> {
  const job = await getSteamReviewsQueue().add(
    STEAM_REVIEWS_JOB,
    { reason },
    {
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 20,
      removeOnFail: 20,
    },
  );
  return job.id;
}

/** (Re)arm the repeat from the current rule; returns the interval in days. */
export async function armSteamSummaries(): Promise<number> {
  const days = (await rulesSettings({ fresh: true })).steamReviews.intervalDays;
  const q = getSteamReviewsQueue();
  for (const r of await q.getRepeatableJobs()) {
    if (r.name === SCHEDULED_JOB) await q.removeRepeatableByKey(r.key);
  }
  await q.add(
    SCHEDULED_JOB,
    { reason: 'schedule' },
    { repeat: { every: days * 86_400_000 }, removeOnComplete: 10, removeOnFail: 10 },
  );
  return days;
}

export function startSteamReviewsWorker(): Worker<SteamReviewsJobData> {
  return new Worker<SteamReviewsJobData>(
    STEAM_REVIEWS_QUEUE,
    async (_job: Job<SteamReviewsJobData>) => runSteamReviewSummaries(),
    { connection: queueConnection(), concurrency: 1 },
  );
}
