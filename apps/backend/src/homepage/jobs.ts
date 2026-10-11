import { Queue, Worker, type Job } from 'bullmq';
import { queueConnection } from '../queue/connection';
import { redis } from '../redis/client';
import { computeHomepageSnapshots } from './compute';
import { homepageSettings } from './settings';

/**
 * The homepage snapshots job (Phase P S2; CLAUDE.md "nothing heavy on user
 * request"). Enqueued on every config / pin / settings save ("saving invalidates
 * the homepage cache"), at boot, and on a repeatable at the admin-set cadence;
 * the ingest / rating / reputation jobs also recompute inline at their end. The
 * trigger route returns the job id so callers wait for THEIR run.
 */
export const HOMEPAGE_QUEUE = 'homepage';
export const HOMEPAGE_JOB = 'compute-homepage';
export const HOMEPAGE_REFRESH_JOB = 'refresh-homepage';
export const HOMEPAGE_STATE_KEY = 'gameskeep:homepage:last-compute';

export interface HomepageJobData {
  reason?: string;
}

let queue: Queue<HomepageJobData> | null = null;

export function getHomepageQueue(): Queue<HomepageJobData> {
  if (queue) return queue;
  queue = new Queue<HomepageJobData>(HOMEPAGE_QUEUE, { connection: queueConnection() });
  return queue;
}

/** Enqueue a recompute; returns the BullMQ job id. */
export async function enqueueHomepageCompute(
  data: HomepageJobData = {},
): Promise<string | undefined> {
  const job = await getHomepageQueue().add(HOMEPAGE_JOB, data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 50,
    removeOnFail: 50,
  });
  return job.id;
}

/**
 * (Re-)arm the periodic refresh at the admin cadence (`homepage.refreshMinutes`).
 * Idempotent: any previous repeatable of this job is removed first, so a cadence
 * change never leaves two schedules running.
 */
export async function armHomepageRefresh(): Promise<number> {
  const minutes = (await homepageSettings()).refreshMinutes;
  const q = getHomepageQueue();
  for (const r of await q.getRepeatableJobs()) {
    if (r.name === HOMEPAGE_REFRESH_JOB) await q.removeRepeatableByKey(r.key);
  }
  await q.add(
    HOMEPAGE_REFRESH_JOB,
    { reason: 'refresh' },
    { repeat: { every: minutes * 60_000 }, removeOnComplete: 10, removeOnFail: 10 },
  );
  return minutes;
}

/** Inline recompute for the end of another background job — never throws. */
export async function recomputeHomepageQuietly(reason: string): Promise<void> {
  try {
    const sections = await computeHomepageSnapshots();
    await redis.set(
      HOMEPAGE_STATE_KEY,
      JSON.stringify({ sections, reason, finishedAt: new Date().toISOString() }),
    );
  } catch (err) {
    // A snapshot hiccup must never fail the ingest / rating job that called it;
    // the periodic refresh catches up.
    console.error(`[homepage] inline recompute after ${reason} failed:`, err);
  }
}

export function startHomepageWorker(): Worker<HomepageJobData> {
  return new Worker<HomepageJobData>(
    HOMEPAGE_QUEUE,
    async (job: Job<HomepageJobData>): Promise<{ sections: number }> => {
      const sections = await computeHomepageSnapshots();
      await redis.set(
        HOMEPAGE_STATE_KEY,
        JSON.stringify({
          sections,
          reason: job.data.reason ?? 'manual',
          finishedAt: new Date().toISOString(),
          jobId: job.id,
        }),
      );
      return { sections };
    },
    { connection: queueConnection(), concurrency: 1 },
  );
}
