import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { games, subjects } from '../db/schema';
import { slugify } from '../lib/slug';
import type { CleanGame } from './normalize';

/**
 * Idempotent game upsert (SPEC I2 §2: "re-running doesn't duplicate"). A Game is
 * a Subject specialization, so this keeps the `subjects` (identity) and `games`
 * (metadata) rows in sync, keyed by the deterministic slug. If a game already
 * exists for that slug it is left untouched — imports never clobber editor
 * overrides (CLAUDE.md auto + manual override rule). Returns whether a NEW game
 * row was created so the importer can report real numbers.
 */
export interface UpsertResult {
  created: boolean;
  subjectId: string;
  gameId: string;
}

export async function upsertGameFromNormalized(clean: CleanGame): Promise<UpsertResult> {
  const slug = clean.slug ?? slugify(clean.name);

  // 1) ensure the Subject (type=game) for this slug exists.
  let subjectId: string;
  const [existingSubject] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(eq(subjects.slug, slug))
    .limit(1);
  if (existingSubject) {
    subjectId = existingSubject.id;
  } else {
    const [inserted] = await db
      .insert(subjects)
      .values({ type: 'game', slug, name: clean.name })
      .onConflictDoNothing()
      .returning({ id: subjects.id });
    if (inserted) {
      subjectId = inserted.id;
    } else {
      // Lost an insert race — re-read the row the other writer created.
      const [again] = await db
        .select({ id: subjects.id })
        .from(subjects)
        .where(eq(subjects.slug, slug))
        .limit(1);
      if (!again) throw new Error(`upsert: subject vanished for slug "${slug}"`);
      subjectId = again.id;
    }
  }

  // 2) ensure the Game row for that Subject. Skip if present (no clobber).
  const [existingGame] = await db
    .select({ id: games.id })
    .from(games)
    .where(eq(games.subjectId, subjectId))
    .limit(1);
  if (existingGame) {
    return { created: false, subjectId, gameId: existingGame.id };
  }

  const { name: _name, slug: _slug, ...gameFields } = clean;
  void _name;
  void _slug;
  const [game] = await db
    .insert(games)
    .values({ ...gameFields, subjectId })
    .onConflictDoNothing()
    .returning({ id: games.id });
  if (game) return { created: true, subjectId, gameId: game.id };

  // Race on the games.subject_id unique constraint — re-read.
  const [raced] = await db
    .select({ id: games.id })
    .from(games)
    .where(eq(games.subjectId, subjectId))
    .limit(1);
  if (!raced) throw new Error(`upsert: game vanished for subject "${subjectId}"`);
  return { created: false, subjectId, gameId: raced.id };
}

/** Build the flat {name, slug, ...game} view of a game (for audit payloads). */
export async function flatGame(subjectId: string): Promise<Record<string, unknown> | null> {
  const [row] = await db
    .select()
    .from(games)
    .innerJoin(subjects, eq(games.subjectId, subjects.id))
    .where(and(eq(games.subjectId, subjectId)))
    .limit(1);
  if (!row) return null;
  return { ...row.games, name: row.subjects.name, slug: row.subjects.slug };
}
