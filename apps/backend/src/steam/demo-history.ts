import { and, asc, eq, sql } from 'drizzle-orm';
import { isDemo } from '../config/env';
import { db } from '../db/client';
import { gamePlayerCounts } from '../db/schema';

/**
 * Demo player-count history (Phase P S2). The owner decided samples are DAILY
 * (mock history too) so a 7-day By-players Δ has data in both windows. The seed
 * writes the B2 weekly shape; at every demo boot this:
 *   1. marks every row demo (`demo_seed`) — in demo the Steam sweep is never
 *      armed and the mock provider returns nothing, so every row is mock;
 *   2. expands a weekly series into DAILY samples (linear between the weekly
 *      points + a small deterministic wobble), keeping the recorded peak;
 *   3. moves the demo series so its newest sample lands just before boot,
 *      spacing kept (same rule as the mock feed).
 * Never runs outside demo; never touches a row that isn't demo-marked.
 */
const DAY = 86_400_000;
/** A series with fewer samples than this is the weekly seed shape. */
const DAILY_MIN_POINTS = 60;
/** Smaller drifts are left alone (a quick restart rewrites nothing). */
const REALIGN_MIN_SHIFT_MS = 60 * 60 * 1000;

/** Deterministic 0..1 from a string (stable wobble per game + day). */
function unit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

export interface WeeklyPoint {
  at: number;
  current: number;
  peak: number | null;
}

/**
 * Expand ascending weekly points into daily samples: linear between neighbours,
 * the weekly anchors exact, and the days in between carrying a per-game drift
 * for that week (±10 %), a ±4 % daily wobble and a small weekend lift — all
 * deterministic per game, so mock games don't move in lockstep. Pure — exported
 * for the unit test.
 */
export function expandToDaily(points: WeeklyPoint[], key: string): WeeklyPoint[] {
  const pts = points
    .filter((p) => Number.isFinite(p.at) && Number.isFinite(p.current) && p.current >= 0)
    .sort((a, b) => a.at - b.at);
  if (pts.length < 2) return pts;
  const out: WeeklyPoint[] = [];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const days = Math.max(1, Math.round((b.at - a.at) / DAY));
    for (let d = 0; d < days; d += 1) {
      const at = a.at + d * DAY;
      const base = a.current + ((b.current - a.current) * d) / days;
      if (d === 0) {
        out.push({ at, current: Math.round(base), peak: null }); // weekly anchor, exact
        continue;
      }
      const weekday = new Date(at).getUTCDay();
      const weekend = weekday === 0 || weekday === 6 ? 1.05 : 1;
      const drift = 0.9 + unit(`${key}:w${i}`) * 0.2;
      const wobble = 0.96 + unit(`${key}:${Math.floor(at / DAY)}`) * 0.08;
      out.push({
        at,
        current: Math.max(0, Math.round(base * drift * wobble * weekend)),
        peak: null,
      });
    }
  }
  const last = pts[pts.length - 1]!;
  out.push({ at: last.at, current: last.current, peak: last.peak });
  return out;
}

export async function ensureDemoPlayerHistory(
  now: Date = new Date(),
): Promise<{ expanded: number; shiftedHours: number } | null> {
  if (!isDemo()) return null;
  await db
    .update(gamePlayerCounts)
    .set({ demoSeed: true })
    .where(eq(gamePlayerCounts.demoSeed, false));

  // 2. weekly → daily, per game
  const counts = await db
    .select({ gameId: gamePlayerCounts.gameId, n: sql<number>`count(*)::int` })
    .from(gamePlayerCounts)
    .where(eq(gamePlayerCounts.demoSeed, true))
    .groupBy(gamePlayerCounts.gameId);
  let expanded = 0;
  for (const c of counts) {
    if (c.n >= DAILY_MIN_POINTS) continue;
    const rows = await db
      .select({
        at: gamePlayerCounts.capturedAt,
        current: gamePlayerCounts.currentPlayers,
        peak: gamePlayerCounts.peakPlayers,
        source: gamePlayerCounts.source,
      })
      .from(gamePlayerCounts)
      .where(and(eq(gamePlayerCounts.gameId, c.gameId), eq(gamePlayerCounts.demoSeed, true)))
      .orderBy(asc(gamePlayerCounts.capturedAt));
    const daily = expandToDaily(
      rows
        .filter((r) => r.current != null)
        .map((r) => ({ at: r.at.getTime(), current: r.current!, peak: r.peak ?? null })),
      c.gameId,
    );
    if (daily.length <= rows.length) continue;
    const source = rows[0]?.source ?? 'steam';
    await db.transaction(async (tx) => {
      await tx
        .delete(gamePlayerCounts)
        .where(and(eq(gamePlayerCounts.gameId, c.gameId), eq(gamePlayerCounts.demoSeed, true)));
      for (let i = 0; i < daily.length; i += 500) {
        await tx.insert(gamePlayerCounts).values(
          daily.slice(i, i + 500).map((p) => ({
            gameId: c.gameId,
            source,
            currentPlayers: p.current,
            peakPlayers: p.peak,
            capturedAt: new Date(p.at),
            demoSeed: true,
          })),
        );
      }
    });
    expanded += 1;
  }

  // 3. newest demo sample → just before boot (spacing kept)
  const [newest] = await db
    .select({
      at: sql<Date | null>`max(${gamePlayerCounts.capturedAt})`.mapWith(
        gamePlayerCounts.capturedAt,
      ),
    })
    .from(gamePlayerCounts)
    .where(eq(gamePlayerCounts.demoSeed, true));
  let shiftedHours = 0;
  if (newest?.at instanceof Date) {
    const shift = now.getTime() - 60 * 60 * 1000 - newest.at.getTime();
    if (Math.abs(shift) >= REALIGN_MIN_SHIFT_MS) {
      await db
        .update(gamePlayerCounts)
        .set({
          capturedAt: sql`${gamePlayerCounts.capturedAt} + (${shift}::bigint * interval '1 millisecond')`,
        })
        .where(eq(gamePlayerCounts.demoSeed, true));
      shiftedHours = Math.round(shift / 3_600_000);
    }
  }
  return { expanded, shiftedHours };
}
