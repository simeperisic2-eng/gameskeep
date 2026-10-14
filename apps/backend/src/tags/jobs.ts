import { Queue, Worker, type Job } from 'bullmq';
import { queueConnection } from '../queue/connection';
import { recomputeHomepageQuietly } from '../homepage/jobs';
import { migrateLegacyPayToWin, syncImportedTags } from './service';

/**
 * The tag import-mapping job (Phase P S3b — nothing heavy on the request path).
 * Maps imported free-form tags onto the taxonomy in batches, queues the rest as
 * suggestions, and finishes the legacy Pay-to-win hand-over. Enqueued at boot,
 * after every catalog import and by the admin "Re-run import mapping" button;
 * each trigger returns the job id so the caller waits for ITS run.
 */
export const TAGS_QUEUE = 'tags';
export const TAGS_SYNC_JOB = 'sync-imported-tags';

export interface TagsJobData {
  reason?: string;
}
export interface TagsJobResult {
  mapped: number;
  queued: number;
  payToWin: number;
}

let queue: Queue<TagsJobData> | null = null;

export function getTagsQueue(): Queue<TagsJobData> {
  if (queue) return queue;
  queue = new Queue<TagsJobData>(TAGS_QUEUE, { connection: queueConnection() });
  return queue;
}

export async function enqueueTagSync(data: TagsJobData = {}): Promise<string | undefined> {
  const job = await getTagsQueue().add(TAGS_SYNC_JOB, data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 50,
    removeOnFail: 50,
  });
  return job.id;
}

export function startTagsWorker(): Worker<TagsJobData> {
  return new Worker<TagsJobData>(
    TAGS_QUEUE,
    async (_job: Job<TagsJobData>): Promise<TagsJobResult> => {
      const synced = await syncImportedTags();
      const payToWin = await migrateLegacyPayToWin();
      if (synced.mapped || synced.queued || payToWin) await recomputeHomepageQuietly('tags');
      return { ...synced, payToWin };
    },
    { connection: queueConnection(), concurrency: 1 },
  );
}
