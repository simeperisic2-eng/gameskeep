import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { games } from '../db/schema';
import { writeAudit, type AuditActor } from '../admin/audit';

/**
 * Game status DERIVED from the release date, with a manual override (Phase P
 * hygiene 3). A pre-release game (announced / in development) whose FULL release
 * date (YYYY-MM-DD) has passed is released — unless staff set its status by hand
 * (`status_locked`, set by any staff status edit). Early access is a distinct
 * state (its date is the EA launch), so it never flips; partial dates ("2026",
 * "2026-Q3") never flip. Every change is audited as a SYSTEM actor, which the
 * demo-seed refresh guard does not count as a human edit.
 */
export const GAME_STATUS_ACTOR: AuditActor = { label: 'system:game-status' };

/** Today in UTC as YYYY-MM-DD (release dates are calendar dates). */
function todayUtc(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** A real calendar date string (rejects "2026-02-30", which JS would roll over). */
function isRealDate(value: string): boolean {
  const t = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value;
}

const PRE_RELEASE: ReadonlySet<string> = new Set(['announced', 'in_development']);

/** Pure rule: does this game's status derive to "released" today (YYYY-MM-DD, UTC)? */
export function derivesReleased(
  game: { status: string; statusLocked: boolean; releaseDate: string | null },
  today: string,
): boolean {
  if (game.statusLocked || !PRE_RELEASE.has(game.status)) return false;
  const date = game.releaseDate?.trim() ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isRealDate(date)) return false;
  return date <= today;
}

/**
 * The status lock a staff game edit leaves (pure). A CHANGED status is a manual
 * override and locks it, whatever else the request carries — the admin form
 * always sends its checkbox value, so a `statusLocked: false` riding along with a
 * status change cannot mean "unlock". With the status unchanged, an explicit
 * `statusLocked` is honoured (lock / unlock). Null = leave the flag alone.
 */
export function statusLockFor(
  beforeStatus: string,
  input: { status?: unknown; statusLocked?: unknown },
  rawKeys: readonly string[],
): boolean | null {
  if (rawKeys.includes('status') && typeof input.status === 'string') {
    if (input.status !== beforeStatus) return true;
  }
  if (rawKeys.includes('statusLocked') && typeof input.statusLocked === 'boolean') {
    return input.statusLocked;
  }
  return null;
}

export async function syncDerivedGameStatuses(now: Date = new Date()): Promise<number> {
  const today = todayUtc(now);
  const candidates = await db
    .select({
      id: games.id,
      status: games.status,
      statusLocked: games.statusLocked,
      releaseDate: games.releaseDate,
    })
    .from(games)
    .where(
      and(
        inArray(games.status, ['announced', 'in_development']),
        eq(games.statusLocked, false),
        sql`${games.releaseDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`,
      ),
    );
  let changed = 0;
  for (const g of candidates) {
    if (!derivesReleased(g, today)) continue;
    const updated = await db
      .update(games)
      .set({ status: 'released', updatedAt: new Date() })
      // Race-safe: only if nobody changed or locked it since we read it.
      .where(and(eq(games.id, g.id), eq(games.status, g.status), eq(games.statusLocked, false)))
      .returning({ id: games.id });
    if (updated.length === 0) continue;
    changed += 1;
    await writeAudit({
      action: 'update',
      entityType: 'games',
      entityId: g.id,
      changes: { status: { from: g.status, to: 'released' } },
      summary: `release date ${g.releaseDate} passed — status derived as released`,
      actor: GAME_STATUS_ACTOR,
    });
  }
  return changed;
}
