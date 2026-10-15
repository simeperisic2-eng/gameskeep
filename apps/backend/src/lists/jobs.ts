import { Queue, Worker, type Job } from 'bullmq';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { db } from '../db/client';
import {
  editorialListConsensus,
  editorialListEntries,
  editorialLists,
  games,
  subjects,
} from '../db/schema';
import { addDebounced } from '../jobs/debounce';
import { queueConnection } from '../queue/connection';
import { rulesSettings } from '../rules/settings';
import { computeConsensus, type ConsensusList } from './rules';

/**
 * The editorial-list consensus job (Phase P S4). Recomputes every (year,
 * category) from the CONFIRMED lists and replaces the stored rows in one
 * transaction — the public pages only read them. Triggered by any list change,
 * a list-category edit, an editorialLists rule change, and boot.
 */
export const LISTS_QUEUE = 'lists';
export const LISTS_CONSENSUS_JOB = 'recompute-consensus';
const AUTO_JOB_ID = 'lists-auto-recompute';

export interface ListsJobData {
  reason?: string;
}

let queue: Queue<ListsJobData> | null = null;

export function getListsQueue(): Queue<ListsJobData> {
  if (queue) return queue;
  queue = new Queue<ListsJobData>(LISTS_QUEUE, { connection: queueConnection() });
  return queue;
}

/** A recompute with its own job id (the caller waits for ITS run). */
export async function enqueueConsensus(data: ListsJobData = {}): Promise<string | undefined> {
  const job = await getListsQueue().add(LISTS_CONSENSUS_JOB, data, {
    attempts: 2,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 50,
    removeOnFail: 50,
  });
  return job.id;
}

/** Debounced (a burst of entry edits = one recompute a moment later; never lost mid-run). */
export async function requestConsensus(reason: string): Promise<void> {
  try {
    await addDebounced(getListsQueue(), LISTS_CONSENSUS_JOB, { reason }, AUTO_JOB_ID, 1000);
  } catch {
    /* best-effort */
  }
}

export async function recomputeConsensus(): Promise<{ pairs: number; rows: number }> {
  const rules = (await rulesSettings({ fresh: true })).editorialLists;
  const lists = await db
    .select({
      id: editorialLists.id,
      outlet: editorialLists.outletName,
      url: editorialLists.url,
      year: editorialLists.year,
      categoryKey: editorialLists.categoryKey,
    })
    .from(editorialLists)
    .where(
      and(
        eq(editorialLists.status, 'confirmed'),
        isNotNull(editorialLists.year),
        isNotNull(editorialLists.categoryKey),
      ),
    );
  const entries = lists.length
    ? await db
        .select({
          listId: editorialListEntries.listId,
          rank: editorialListEntries.rank,
          gameId: editorialListEntries.gameId,
        })
        .from(editorialListEntries)
        .where(
          inArray(
            editorialListEntries.listId,
            lists.map((l) => l.id),
          ),
        )
    : [];
  const gameIds = [...new Set(entries.map((e) => e.gameId).filter((g): g is string => Boolean(g)))];
  const names = new Map(
    gameIds.length
      ? (
          await db
            .select({ id: games.id, name: subjects.name })
            .from(games)
            .innerJoin(subjects, eq(subjects.id, games.subjectId))
            .where(inArray(games.id, gameIds))
        ).map((g) => [g.id, g.name])
      : [],
  );
  const byPair = new Map<string, { year: number; categoryKey: string; lists: ConsensusList[] }>();
  for (const l of lists) {
    const key = `${l.year}:${l.categoryKey}`;
    const p = byPair.get(key) ?? { year: l.year!, categoryKey: l.categoryKey!, lists: [] };
    p.lists.push({
      id: l.id,
      outlet: l.outlet,
      url: l.url,
      entries: entries
        .filter((e) => e.listId === l.id)
        .map((e) => ({ rank: e.rank, gameId: e.gameId })),
    });
    byPair.set(key, p);
  }
  const values: (typeof editorialListConsensus.$inferInsert)[] = [];
  const now = new Date();
  for (const p of byPair.values()) {
    const rows = computeConsensus(
      p.lists,
      { minAppearances: rules.minAppearances, deviationTopN: rules.deviationTopN },
      (id) => names.get(id) ?? id,
    );
    for (const r of rows) {
      values.push({
        year: p.year,
        categoryKey: p.categoryKey,
        gameId: r.gameId,
        appearances: r.appearances,
        avgRank: r.avgRank.toFixed(2),
        bestRank: r.bestRank,
        worstRank: r.worstRank,
        position: r.position,
        inConsensus: r.inConsensus,
        positions: r.positions,
        lines: r.lines,
        computedAt: now,
      });
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(editorialListConsensus);
    for (let i = 0; i < values.length; i += 500) {
      const chunk = values.slice(i, i + 500);
      if (chunk.length) await tx.insert(editorialListConsensus).values(chunk);
    }
  });
  return { pairs: byPair.size, rows: values.length };
}

export function startListsWorker(): Worker<ListsJobData> {
  return new Worker<ListsJobData>(
    LISTS_QUEUE,
    async (_job: Job<ListsJobData>) => recomputeConsensus(),
    { connection: queueConnection(), concurrency: 1 },
  );
}
