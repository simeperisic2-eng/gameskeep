import { check, index, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  integritySignalKindEnum,
  integritySignalOriginEnum,
  integritySignalStatusEnum,
} from './enums';
import { articles } from './articles';
import { users } from './users';
import { primaryId, timestamps } from './_shared';

/**
 * Review-integrity signals (Phase P S1). Evidence-backed facts about how a review
 * was produced — publisher review copy, embargo, sponsored event / press trip.
 * One row per (article, kind). `auto` rows come from the lexicon scan with a
 * short source snippet; `editor` rows carry a moderator's note + date. A row is
 * PUBLIC only when confirmed (or auto-detected while `integrity.autoPublish` is
 * on) — never without evidence (the CHECK below). These rows never feed the bias
 * scores: the engine stays as built; this is a display-side evidence layer.
 */
export const articleIntegritySignals = pgTable(
  'article_integrity_signals',
  {
    id: primaryId(),
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    kind: integritySignalKindEnum('kind').notNull(),
    origin: integritySignalOriginEnum('origin').notNull(),
    status: integritySignalStatusEnum('status').notNull().default('detected'),
    /** The matched source sentence (auto rows) — ≤ INTEGRITY_SNIPPET_MAX chars. */
    evidenceSnippet: varchar('evidence_snippet', { length: 240 }),
    /** A moderator's note (editor rows; optional on a confirmed auto row). */
    editorNote: varchar('editor_note', { length: 500 }),
    /** When the evidence is from (the article's publish date, or the editor's date). */
    evidenceDate: timestamp('evidence_date', { withTimezone: true }),
    decidedByUserId: uuid('decided_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    decidedByLabel: varchar('decided_by_label', { length: 120 }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('article_integrity_one_per_kind').on(t.articleId, t.kind),
    index('article_integrity_status_idx').on(t.status),
    // Never a row without evidence: a snippet or an editor note.
    check(
      'article_integrity_has_evidence',
      sql`${t.evidenceSnippet} IS NOT NULL OR ${t.editorNote} IS NOT NULL`,
    ),
  ],
);

export type ArticleIntegritySignal = typeof articleIntegritySignals.$inferSelect;
