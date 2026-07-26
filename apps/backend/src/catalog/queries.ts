import { and, desc, eq, gt, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { games, subjects, unmatchedGames } from '../db/schema';
import { describeGameProvider } from '../data-source/games';

/**
 * Read-side catalog queries (SPEC I2 §6 + status surfaces). Kept here so the
 * admin routes and the verify script share one definition of "upcoming".
 */

/** Today as YYYY-MM-DD (ISO dates compare lexicographically = chronologically). */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface UpcomingGame {
  subjectId: string;
  gameId: string;
  name: string;
  slug: string;
  status: string;
  releaseDate: string | null;
}

/**
 * Upcoming subset (BLUEPRINT 2.4): pre-release status OR a future release date.
 * The Upcoming *page* is I5 — here we just make the data queryable.
 */
export async function listUpcomingGames(limit = 200): Promise<UpcomingGame[]> {
  const rows = await db
    .select({
      subjectId: subjects.id,
      gameId: games.id,
      name: subjects.name,
      slug: subjects.slug,
      status: games.status,
      releaseDate: games.releaseDate,
    })
    .from(games)
    .innerJoin(subjects, eq(games.subjectId, subjects.id))
    .where(
      or(
        inArray(games.status, ['announced', 'in_development']),
        and(isNotNull(games.releaseDate), gt(games.releaseDate, today())),
      ),
    )
    .orderBy(desc(games.releaseDate))
    .limit(limit);
  return rows;
}

export interface CatalogStats {
  provider: ReturnType<typeof describeGameProvider>;
  totalGames: number;
  upcomingGames: number;
  byStatus: Record<string, number>;
  unmatched: { pending: number; resolved: number; dismissed: number };
}

export async function getCatalogStats(): Promise<CatalogStats> {
  const [{ total }] = (await db.select({ total: sql<number>`count(*)::int` }).from(games)) as [
    { total: number },
  ];

  const statusRows = await db
    .select({ status: games.status, count: sql<number>`count(*)::int` })
    .from(games)
    .groupBy(games.status);
  const byStatus: Record<string, number> = {};
  for (const r of statusRows) byStatus[r.status] = r.count;

  const unmatchedRows = await db
    .select({ status: unmatchedGames.status, count: sql<number>`count(*)::int` })
    .from(unmatchedGames)
    .groupBy(unmatchedGames.status);
  const unmatched = { pending: 0, resolved: 0, dismissed: 0 };
  for (const r of unmatchedRows) {
    if (r.status in unmatched) unmatched[r.status as keyof typeof unmatched] = r.count;
  }

  const upcoming = await listUpcomingGames(10_000);

  return {
    provider: describeGameProvider(),
    totalGames: total,
    upcomingGames: upcoming.length,
    byStatus,
    unmatched,
  };
}
