import { and, eq, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { games, subjects, unmatchedGames } from '../db/schema';
import { getGameDataProvider } from '../data-source/games';
import { slugify } from '../lib/slug';
import { writeAudit, type AuditActor } from '../admin/audit';
import { sanitizeNormalizedGame, type CleanGame } from './normalize';
import { flatGame, upsertGameFromNormalized } from './upsert';

/**
 * Auto-resolve + unmatched queue (SPEC I2 §3/§4). The path the I3 article
 * pipeline will call: given a raw game name, try the DB, then the provider
 * (which in demo is the mock dataset, in prod IGDB→RAWG). If the provider can
 * identify it, the game is auto-created; otherwise the reference is filed into
 * the unmatched queue for an editor. Every write is audit-logged.
 */
export interface GameRef {
  subjectId: string;
  gameId: string;
}

export type ResolveOutcomeStatus = 'matched' | 'created' | 'queued' | 'unresolved';

export interface ResolveOutcome {
  status: ResolveOutcomeStatus;
  name: string;
  subjectId?: string;
  gameId?: string;
  unmatchedId?: string;
}

/** Find an existing game by deterministic slug or case-insensitive exact name. */
export async function findGameByName(name: string): Promise<GameRef | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const slug = slugify(trimmed);
  const [row] = await db
    .select({ subjectId: subjects.id, gameId: games.id })
    .from(subjects)
    .innerJoin(games, eq(games.subjectId, subjects.id))
    .where(
      and(
        eq(subjects.type, 'game'),
        or(eq(subjects.slug, slug), sql`lower(${subjects.name}) = ${trimmed.toLowerCase()}`),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** DB first, then provider auto-create. Returns 'unresolved' if neither knows it. */
export async function resolveGameByName(name: string, actor: AuditActor): Promise<ResolveOutcome> {
  const trimmed = name.trim();
  if (!trimmed) return { status: 'unresolved', name };

  const existing = await findGameByName(trimmed);
  if (existing) return { status: 'matched', name: trimmed, ...existing };

  const provider = getGameDataProvider();
  // A provider hiccup must never crash the caller (anti-bug rule).
  const normalized = await provider.resolveByName(trimmed).catch(() => null);
  if (!normalized) return { status: 'unresolved', name: trimmed };

  const clean = sanitizeNormalizedGame(normalized);
  if (!clean) return { status: 'unresolved', name: trimmed };

  const result = await upsertGameFromNormalized(clean);
  if (result.created) {
    const flat = await flatGame(result.subjectId);
    await writeAudit({
      action: 'create',
      entityType: 'games',
      entityId: result.gameId,
      changes: { auto_resolved_from: trimmed, provider: provider.name, created: flat },
      summary: `auto-resolved & created game "${trimmed}" via ${provider.name} provider`,
      actor,
    });
    return { status: 'created', name: trimmed, subjectId: result.subjectId, gameId: result.gameId };
  }
  return { status: 'matched', name: trimmed, subjectId: result.subjectId, gameId: result.gameId };
}

/** Resolve, or file an unmatched-queue entry (deduped by pending name). */
export async function resolveOrQueue(
  name: string,
  context: Record<string, unknown> | undefined,
  actor: AuditActor,
): Promise<ResolveOutcome> {
  const outcome = await resolveGameByName(name, actor);
  if (outcome.status !== 'unresolved') return outcome;

  const rawName = (name.trim() || '(empty reference)').slice(0, 300);

  // Dedupe: bump an existing pending row instead of stacking duplicates.
  const [pending] = await db
    .select()
    .from(unmatchedGames)
    .where(
      and(
        eq(unmatchedGames.status, 'pending'),
        sql`lower(${unmatchedGames.rawName}) = ${rawName.toLowerCase()}`,
      ),
    )
    .limit(1);

  if (pending) {
    const attempts = (pending.attempts ?? 0) + 1;
    await db
      .update(unmatchedGames)
      .set({ attempts, lastTriedAt: new Date(), rawContext: context ?? pending.rawContext })
      .where(eq(unmatchedGames.id, pending.id));
    await writeAudit({
      action: 'update',
      entityType: 'unmatched-games',
      entityId: pending.id,
      changes: { attempts: { from: pending.attempts, to: attempts } },
      summary: `re-queued unmatched game "${rawName}" (attempt ${attempts})`,
      actor,
    });
    return { status: 'queued', name: rawName, unmatchedId: pending.id };
  }

  const [created] = await db
    .insert(unmatchedGames)
    .values({
      rawName,
      rawContext: context ?? null,
      status: 'pending',
      attempts: 1,
      lastTriedAt: new Date(),
    })
    .returning();
  if (!created) throw new Error('resolveOrQueue: failed to file unmatched row');
  await writeAudit({
    action: 'create',
    entityType: 'unmatched-games',
    entityId: created.id,
    changes: { created },
    summary: `queued unmatched game "${rawName}"`,
    actor,
  });
  return { status: 'queued', name: rawName, unmatchedId: created.id };
}

interface UnmatchedRow {
  id: string;
  rawName: string;
  status: string;
}

async function getUnmatched(id: string): Promise<UnmatchedRow | null> {
  const [row] = await db
    .select({
      id: unmatchedGames.id,
      rawName: unmatchedGames.rawName,
      status: unmatchedGames.status,
    })
    .from(unmatchedGames)
    .where(eq(unmatchedGames.id, id))
    .limit(1);
  return row ?? null;
}

/** Editor action: re-run auto-resolution on a queued reference. */
export async function retryUnmatched(
  id: string,
  actor: AuditActor,
): Promise<ResolveOutcome | null> {
  const row = await getUnmatched(id);
  if (!row) return null;
  const outcome = await resolveGameByName(row.rawName, actor);
  if (outcome.status === 'matched' || outcome.status === 'created') {
    await markResolved(id, outcome.subjectId ?? null, 'auto-resolved on retry', actor);
    return outcome;
  }
  await db
    .update(unmatchedGames)
    .set({ attempts: sql`${unmatchedGames.attempts} + 1`, lastTriedAt: new Date() })
    .where(eq(unmatchedGames.id, id));
  return { status: 'queued', name: row.rawName, unmatchedId: id };
}

async function markResolved(
  id: string,
  subjectId: string | null,
  note: string,
  actor: AuditActor,
): Promise<void> {
  await db
    .update(unmatchedGames)
    .set({
      status: 'resolved',
      resolvedSubjectId: subjectId,
      resolutionNote: note,
      resolvedAt: new Date(),
    })
    .where(eq(unmatchedGames.id, id));
  await writeAudit({
    action: 'update',
    entityType: 'unmatched-games',
    entityId: id,
    changes: { status: { from: 'pending', to: 'resolved' }, resolvedSubjectId: subjectId, note },
    summary: `resolved unmatched reference (${note})`,
    actor,
  });
}

/** Editor action: link a queued reference to an existing game's Subject. */
export async function linkUnmatched(
  id: string,
  subjectId: string,
  note: string | undefined,
  actor: AuditActor,
): Promise<GameRef | null> {
  const row = await getUnmatched(id);
  if (!row) return null;
  const [game] = await db
    .select({ subjectId: subjects.id, gameId: games.id })
    .from(subjects)
    .innerJoin(games, eq(games.subjectId, subjects.id))
    .where(and(eq(subjects.id, subjectId), eq(subjects.type, 'game')))
    .limit(1);
  if (!game) return null; // not a game subject → route returns 400
  await markResolved(id, subjectId, note ?? `linked to existing game`, actor);
  return game;
}

/** Editor action: create a new game from the queue, then mark the row resolved. */
export async function createGameForUnmatched(
  id: string,
  input: CleanGame,
  actor: AuditActor,
): Promise<GameRef | null> {
  const row = await getUnmatched(id);
  if (!row) return null;
  const result = await upsertGameFromNormalized(input);
  const flat = await flatGame(result.subjectId);
  await writeAudit({
    action: 'create',
    entityType: 'games',
    entityId: result.gameId,
    changes: { created_from_unmatched: row.rawName, created: flat },
    summary: `created game from unmatched reference "${row.rawName}"`,
    actor,
  });
  await markResolved(id, result.subjectId, 'created new game', actor);
  return { subjectId: result.subjectId, gameId: result.gameId };
}

/** Editor action: dismiss a queued reference (spam / not a game / dupe). */
export async function dismissUnmatched(
  id: string,
  note: string | undefined,
  actor: AuditActor,
): Promise<boolean> {
  const row = await getUnmatched(id);
  if (!row) return false;
  await db
    .update(unmatchedGames)
    .set({ status: 'dismissed', resolutionNote: note ?? null, resolvedAt: new Date() })
    .where(eq(unmatchedGames.id, id));
  await writeAudit({
    action: 'update',
    entityType: 'unmatched-games',
    entityId: id,
    changes: { status: { from: row.status, to: 'dismissed' }, note },
    summary: `dismissed unmatched reference "${row.rawName}"`,
    actor,
  });
  return true;
}
