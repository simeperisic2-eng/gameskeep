import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { unmatchedStatusEnum } from './enums';
import { subjects } from './subjects';
import { primaryId, timestamps } from './_shared';

/**
 * Unmatched-game queue — the coverage safety net (BLUEPRINT data-source reality,
 * SPEC I2 §3). When something references a game we don't have and neither the DB
 * nor the provider (mock in demo / IGDB+RAWG in prod) can resolve it, the raw
 * reference lands here `pending` so an editor can later link it to an existing
 * game, create a new one, or dismiss it. This means "a new game we don't have
 * yet" never silently breaks the article pipeline (I3) or anything downstream.
 *
 * `rawContext` is freeform diagnostic metadata (e.g. the article title/source
 * that mentioned the game) — never trusted as structured input. The FK to the
 * resolved Subject is ON DELETE SET NULL so deleting a game never orphans a row.
 */
export const unmatchedGames = pgTable(
  'unmatched_games',
  {
    id: primaryId(),
    rawName: varchar('raw_name', { length: 300 }).notNull(),
    rawContext: jsonb('raw_context').$type<Record<string, unknown>>(),
    status: unmatchedStatusEnum('status').notNull().default('pending'),
    // How many times auto-resolution has been attempted (DB → provider).
    attempts: integer('attempts').notNull().default(0),
    lastTriedAt: timestamp('last_tried_at', { withTimezone: true }),
    resolvedSubjectId: uuid('resolved_subject_id').references(() => subjects.id, {
      onDelete: 'set null',
    }),
    resolutionNote: text('resolution_note'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index('unmatched_games_status_idx').on(t.status)],
);
