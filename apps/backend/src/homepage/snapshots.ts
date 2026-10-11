import { sql } from 'drizzle-orm';
import type { HomepageSectionKey } from '@gameskeep/shared/constants';
import { db } from '../db/client';
import { homepageSectionSnapshots } from '../db/schema';
import type { Delta } from './rules';

/**
 * The stored section snapshots (Phase P S2) — written by the snapshots job
 * (`compute.ts`), read by the homepage request. Kept apart from the compute
 * module so the public read path never imports the ranking code.
 */
export interface SnapshotItem {
  type: 'topic' | 'game';
  slug: string;
  pinned: boolean;
  /** Paid placement (discovery sections only) — the label is render-forced. */
  promoted: { advertiser: string } | null;
  /** Trending / By players only. */
  delta: Delta | null;
  /** The ranking metric (Trending score / average players / mean score / gap). */
  metric: number | null;
}

export interface SnapshotPayload {
  key: HomepageSectionKey;
  /** The Δ window in hours (sections that show a Δ). */
  windowHours: number | null;
  items: SnapshotItem[];
}

/** Stored snapshots by section key, with when each was computed. */
export async function readSnapshots(): Promise<
  Map<string, { payload: SnapshotPayload; computedAt: Date }>
> {
  const rows = await db.select().from(homepageSectionSnapshots);
  return new Map(
    rows.map((r) => [
      r.sectionKey,
      { payload: r.payload as SnapshotPayload, computedAt: r.computedAt },
    ]),
  );
}

/** Snapshot freshness for the admin (null before the first run). */
export async function lastSnapshotAt(): Promise<string | null> {
  const [row] = await db
    .select({
      at: sql<Date | null>`max(${homepageSectionSnapshots.computedAt})`.mapWith(
        homepageSectionSnapshots.computedAt,
      ),
    })
    .from(homepageSectionSnapshots);
  return row?.at instanceof Date ? row.at.toISOString() : null;
}
