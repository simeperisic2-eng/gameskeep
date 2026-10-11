import { Queue, Worker, type Job } from 'bullmq';
import { queueConnection } from '../queue/connection';
import { redis } from '../redis/client';
import { syncDerivedGameStatuses } from './status';
import { importCatalog, type CatalogImportResult } from './import';

/**
 * Catalog-import background job (SPEC I2 §2; CLAUDE.md "nothing heavy on user
 * request"). The broad game catalog is loaded off the request path by the
 * worker — exactly the pattern I3's article pulls will reuse. The API enqueues
 * it on boot (demo); editors can re-trigger it from the admin. The importer is
 * idempotent, so repeated runs never duplicate.
 */
export const CATALOG_QUEUE = 'catalog';
export const CATALOG_IMPORT_JOB = 'import-catalog';
export const CATALOG_STATE_KEY = 'gameskeep:catalog:last-import';

export interface CatalogJobData {
  skipIfPopulated?: boolean;
  limit?: number;
  reason?: string;
}

export interface CatalogImportState extends CatalogImportResult {
  reason: string;
  finishedAt: string;
}

let queue: Queue<CatalogJobData> | null = null;

/** Lazily create the queue so importing this module has no side effects. */
export function getCatalogQueue(): Queue<CatalogJobData> {
  if (queue) return queue;
  queue = new Queue<CatalogJobData>(CATALOG_QUEUE, { connection: queueConnection() });
  return queue;
}

/** Enqueue a catalog import (off the request path). */
export async function enqueueCatalogImport(data: CatalogJobData = {}): Promise<string | undefined> {
  const q = getCatalogQueue();
  const job = await q.add(CATALOG_IMPORT_JOB, data, {
    removeOnComplete: 20,
    removeOnFail: 20,
    // Retry a few times with backoff so a transient DB hiccup at boot self-heals.
    attempts: 5,
    backoff: { type: 'exponential', delay: 3000 },
  });
  return job.id;
}

export const GAME_STATUS_SYNC_JOB = 'game-status-sync';

/**
 * Arm the daily derived-status pass (hygiene 3) — a release date passing needs
 * no human. Idempotent: BullMQ keys the repeatable job by name + interval.
 */
export async function armGameStatusSync(): Promise<void> {
  await getCatalogQueue().add(
    GAME_STATUS_SYNC_JOB,
    {},
    { repeat: { every: 24 * 60 * 60 * 1000 }, removeOnComplete: 5, removeOnFail: 5 },
  );
}

/** Worker that runs catalog imports. Runs in the worker process. */
export function startCatalogWorker(): Worker<CatalogJobData> {
  return new Worker<CatalogJobData>(
    CATALOG_QUEUE,
    async (
      job: Job<CatalogJobData>,
    ): Promise<CatalogImportResult | { statusesDerived: number }> => {
      // Daily (and on-demand) derived-status pass — no import.
      if (job.name === GAME_STATUS_SYNC_JOB) {
        return { statusesDerived: await syncDerivedGameStatuses() };
      }
      const result = await importCatalog({
        skipIfPopulated: job.data.skipIfPopulated,
        limit: job.data.limit,
      });
      const state: CatalogImportState = {
        ...result,
        reason: job.data.reason ?? 'manual',
        finishedAt: new Date().toISOString(),
      };
      await redis.set(CATALOG_STATE_KEY, JSON.stringify(state));
      // Newly imported games get their status derived from the release date too.
      await syncDerivedGameStatuses();
      return result;
    },
    { connection: queueConnection() },
  );
}

/** Read the last recorded catalog-import result (admin/verify observability). */
export async function readCatalogImportState(): Promise<CatalogImportState | null> {
  const raw = await redis.get(CATALOG_STATE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CatalogImportState;
  } catch {
    return null;
  }
}
