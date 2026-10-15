import { Queue, Worker, type Job } from 'bullmq';
import { addDebounced } from '../jobs/debounce';
import { queueConnection } from '../queue/connection';
import { rebuildSearchIndex } from './index';

/**
 * The search-index job (Phase P S4 — nothing heavy on the request path).
 * Explicit runs (admin "Reindex", boot) return their own job id; automatic
 * refreshes after edits / ingest / imports are DEBOUNCED into one waiting job.
 */
export const SEARCH_QUEUE = 'search';
export const SEARCH_REBUILD_JOB = 'rebuild-search-index';
const AUTO_JOB_ID = 'search-auto-refresh';

export interface SearchJobData {
  reason?: string;
}

let queue: Queue<SearchJobData> | null = null;

export function getSearchQueue(): Queue<SearchJobData> {
  if (queue) return queue;
  queue = new Queue<SearchJobData>(SEARCH_QUEUE, { connection: queueConnection() });
  return queue;
}

/** A full rebuild with its own job id (the caller waits for ITS run). */
export async function enqueueSearchRebuild(data: SearchJobData = {}): Promise<string | undefined> {
  const job = await getSearchQueue().add(SEARCH_REBUILD_JOB, data, {
    attempts: 2,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 50,
    removeOnFail: 50,
  });
  return job.id;
}

/**
 * A debounced refresh after a change: while one is still waiting, further
 * requests join it (a burst of edits = one rebuild a moment later); a change
 * made while a rebuild is running queues a follow-up (see `addDebounced`).
 */
export async function requestSearchRefresh(reason: string): Promise<void> {
  try {
    await addDebounced(getSearchQueue(), SEARCH_REBUILD_JOB, { reason }, AUTO_JOB_ID, 1500);
  } catch {
    /* best-effort: the next refresh (or boot) catches up */
  }
}

export function startSearchWorker(): Worker<SearchJobData> {
  return new Worker<SearchJobData>(
    SEARCH_QUEUE,
    async (_job: Job<SearchJobData>) => rebuildSearchIndex(),
    { connection: queueConnection(), concurrency: 1 },
  );
}
