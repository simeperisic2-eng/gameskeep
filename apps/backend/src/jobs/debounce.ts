import type { Queue } from 'bullmq';

/** A job state in which the run has not started yet (it will see the change). */
const PENDING = new Set(['waiting', 'delayed', 'prioritized', 'waiting-children']);

/**
 * Debounced enqueue (Phase P S4). A burst of changes joins ONE pending run — but
 * BullMQ also ignores a fixed job id while that job is ACTIVE, so a change made
 * mid-run (after the run read its data) would be lost until some later trigger.
 * Two alternating ids fix that: a request during an active run queues the other
 * id as the follow-up. Returns the id that will carry the change.
 */
export async function addDebounced<T>(
  queue: Queue<T>,
  name: string,
  data: T,
  baseId: string,
  delayMs: number,
): Promise<string> {
  const ids = [baseId, `${baseId}-next`];
  for (const id of ids) {
    const job = await queue.getJob(id);
    if (!job) {
      await queue.add(name as never, data as never, {
        jobId: id,
        delay: delayMs,
        removeOnComplete: true,
        removeOnFail: true,
      });
      return id;
    }
    const state = await job.getState();
    if (PENDING.has(state)) return id; // a run that has not started will see this change
    if (state === 'completed' || state === 'failed') {
      // Normally removed on finish; a leftover id must not block the next run.
      await job.remove().catch(() => undefined);
      await queue.add(name as never, data as never, {
        jobId: id,
        delay: delayMs,
        removeOnComplete: true,
        removeOnFail: true,
      });
      return id;
    }
    // active (or unknown) → try the other id as the follow-up
  }
  // Both ids busy (cannot happen with one worker) — a unique follow-up never loses the change.
  const job = await queue.add(name as never, data as never, {
    delay: delayMs,
    removeOnComplete: true,
    removeOnFail: true,
  });
  return job.id ?? baseId;
}
