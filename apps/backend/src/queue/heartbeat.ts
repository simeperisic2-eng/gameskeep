import { Queue, Worker, type Job } from 'bullmq';
import { queueConnection } from './connection';
import { redis } from '../redis/client';

/**
 * The trivial demo background job (CLAUDE.md: "background-job architecture
 * must exist from the start ... one demo job that ... proves the queue works").
 *
 * A repeatable "heartbeat" job runs every 30s; the worker records the run in
 * Redis. The readiness endpoint surfaces it so the queue is observable.
 * In later phases this same architecture runs article pulls, clustering,
 * scoring, etc. — none of it on the user request path.
 */
export const HEARTBEAT_QUEUE = 'heartbeat';
export const HEARTBEAT_STATE_KEY = 'gameskeep:demo:heartbeat';

export interface HeartbeatJobData {
  source: string;
}

export interface HeartbeatState {
  lastRunAt: string;
  count: number;
  lastSource: string;
}

let queue: Queue<HeartbeatJobData> | null = null;

/** Lazily create the queue so importing this module has no side effects. */
export function getHeartbeatQueue(): Queue<HeartbeatJobData> {
  if (queue) return queue;
  queue = new Queue<HeartbeatJobData>(HEARTBEAT_QUEUE, {
    connection: queueConnection(),
  });
  return queue;
}

/**
 * Idempotently register the repeatable heartbeat and fire one immediately so
 * the very first boot shows a heartbeat without waiting for the interval.
 * Called by the API on startup.
 */
export async function scheduleHeartbeat(): Promise<void> {
  const q = getHeartbeatQueue();
  await q.upsertJobScheduler(
    'heartbeat-scheduler',
    { every: 30_000 },
    {
      name: 'tick',
      data: { source: 'scheduler' },
      opts: { removeOnComplete: 50, removeOnFail: 20 },
    },
  );
  await q.add('tick', { source: 'boot' }, { removeOnComplete: 50, removeOnFail: 20 });
}

/** Start a worker that processes heartbeat jobs. Runs in the worker process. */
export function startHeartbeatWorker(): Worker<HeartbeatJobData> {
  return new Worker<HeartbeatJobData>(
    HEARTBEAT_QUEUE,
    async (job: Job<HeartbeatJobData>): Promise<HeartbeatState> => {
      const prev = await redis.get(HEARTBEAT_STATE_KEY);
      let count = 0;
      if (prev) {
        try {
          count = (JSON.parse(prev) as HeartbeatState).count;
        } catch {
          count = 0;
        }
      }
      const state: HeartbeatState = {
        lastRunAt: new Date().toISOString(),
        count: count + 1,
        lastSource: job.data.source,
      };
      await redis.set(HEARTBEAT_STATE_KEY, JSON.stringify(state));
      return state;
    },
    { connection: queueConnection() },
  );
}

/** Read the last recorded heartbeat (for the readiness endpoint). */
export async function readHeartbeat(): Promise<HeartbeatState | null> {
  const raw = await redis.get(HEARTBEAT_STATE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as HeartbeatState;
  } catch {
    return null;
  }
}
