import {
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  integritySignalKindEnum,
  integritySignalOriginEnum,
  integritySignalStatusEnum,
} from './enums';
import { articles } from './articles';
import { sources } from './sources';
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
 *
 * Identity (hygiene 3): a feed article is identified by its SOURCE + feed guid,
 * not by its row id — a full re-cluster deletes and recreates article rows. The
 * link to the row is `SET NULL` on delete and re-attached by identity when the
 * same article is ingested again, so a moderator's decision survives a re-cluster.
 */
export const articleIntegritySignals = pgTable(
  'article_integrity_signals',
  {
    id: primaryId(),
    /** The current article row (null while that article is between a reset and re-ingest). */
    articleId: uuid('article_id').references(() => articles.id, { onDelete: 'set null' }),
    /** Stable identity of a feed article: its source + feed guid. Null for our own articles. */
    sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
    externalGuid: varchar('external_guid', { length: 400 }),
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
    // One row per (feed article, kind) by IDENTITY — also while unlinked.
    uniqueIndex('article_integrity_identity_kind')
      .on(t.externalGuid, t.kind)
      .where(sql`${t.externalGuid} IS NOT NULL`),
    index('article_integrity_status_idx').on(t.status),
    // Never a row without evidence: a snippet or an editor note.
    check(
      'article_integrity_has_evidence',
      sql`${t.evidenceSnippet} IS NOT NULL OR ${t.editorNote} IS NOT NULL`,
    ),
    // Never a row that belongs to nothing: a linked article or a feed identity.
    check(
      'article_integrity_has_identity',
      sql`${t.articleId} IS NOT NULL OR ${t.externalGuid} IS NOT NULL`,
    ),
  ],
);

export type ArticleIntegritySignal = typeof articleIntegritySignals.$inferSelect;

/**
 * Editorial decisions on a feed article (bias overrides + reasons, editor note,
 * internal assessment), held by IDENTITY across a full re-cluster (hygiene 3). A
 * reset snapshots them here before it deletes the article rows; the next ingest
 * re-applies them to the same article (source + guid) and clears the snapshot.
 * Admin-only data (the internal assessment is never public).
 */
export const articleEditorialCarryover = pgTable(
  'article_editorial_carryover',
  {
    externalGuid: varchar('external_guid', { length: 400 }).notNull(),
    sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
    influenceOverride: smallint('influence_override'),
    qualityOverride: smallint('quality_override'),
    influenceOverrideReason: text('influence_override_reason'),
    qualityOverrideReason: text('quality_override_reason'),
    editorNote: text('editor_note'),
    internalAssessment: text('internal_assessment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('article_editorial_carryover_guid').on(t.externalGuid)],
);
