import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  vector,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { EMBEDDING_DIM, type BiasBreakdown } from '@gameskeep/shared/constants';
import { articleOriginEnum, articleTypeEnum } from './enums';
import { sources } from './sources';
import { topics } from './topics';
import { subjects } from './subjects';
import { primaryId, timestamps } from './_shared';

/**
 * Article — BLUEPRINT 2.2. Aggregated (auto-pulled) OR Ours (written in our
 * CMS); same object type. We NEVER store the full text of others' articles
 * (copyright) — only excerpt + AI summary + link. A CHECK enforces that `body`
 * is populated only when origin = 'ours'. The two PUBLIC bias axes are stored
 * SEPARATELY (influence + quality), plus an internal-only assessment that is
 * NEVER shown publicly. Bias values are computed/overridable in I4 (null now).
 */
export const articles = pgTable(
  'articles',
  {
    id: primaryId(),
    slug: varchar('slug', { length: 200 }).notNull().unique(),
    /**
     * Stable per-source feed id (RSS guid / link) used for idempotent ingest
     * (I3): re-running the pipeline skips an article whose guid already exists,
     * so re-pulls never duplicate. Null for our own CMS articles.
     */
    externalGuid: varchar('external_guid', { length: 400 }).unique(),
    sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
    origin: articleOriginEnum('origin').notNull().default('aggregated'),
    articleType: articleTypeEnum('article_type').notNull().default('news'),

    // --- auto-captured fields ---
    title: varchar('title', { length: 300 }).notNull(),
    author: varchar('author', { length: 200 }),
    url: text('url'),
    thumbnailUrl: text('thumbnail_url'),
    excerpt: text('excerpt'),
    /** Full body — ONLY for our own articles (copyright). Enforced by CHECK. */
    body: text('body'),
    aiSummary: text('ai_summary'),
    publishDate: timestamp('publish_date', { withTimezone: true }),
    isPaywalled: boolean('is_paywalled').notNull().default(false),

    // --- detected signals (auto, factual) ---
    hasAffiliateLinks: boolean('has_affiliate_links').notNull().default(false),
    isSponsored: boolean('is_sponsored').notNull().default(false),
    basedOnReviewCopy: boolean('based_on_review_copy').notNull().default(false),

    // --- two PUBLIC bias axes, stored separately (computed in I4a) ---
    // AUTO scores (recomputed on every weight re-tune) + their stored breakdown
    // (the additive "why" — this jsonb IS what I5 renders).
    influenceScore: smallint('influence_score'), // Influenced ↔ Independent (0..100)
    qualityScore: smallint('quality_score'), // Slop ↔ Top (0..100)
    influenceBreakdown: jsonb('influence_breakdown').$type<BiasBreakdown>(),
    qualityBreakdown: jsonb('quality_breakdown').$type<BiasBreakdown>(),
    // EDITOR overrides (auto + manual override rule): null = no override. Retained
    // SEPARATELY so re-tuning weights never clobbers a human decision; the
    // effective public score is `override ?? auto`.
    influenceOverride: smallint('influence_override'),
    qualityOverride: smallint('quality_override'),
    influenceOverrideReason: text('influence_override_reason'),
    qualityOverrideReason: text('quality_override_reason'),
    /**
     * Editor JUDGMENTAL note ("cozy vibes, not gameplay") — editor-entered ONLY,
     * never auto-generated; PUBLIC-eligible (I5 "why"). Distinct from
     * `internalAssessment`, which is the opposite (never public).
     */
    editorNote: text('editor_note'),
    /** INTERNAL ONLY — never displayed publicly (BLUEPRINT 2.2; walled off in I4a). */
    internalAssessment: text('internal_assessment'),
    /** Mechanical event-kind for the clustering secondary gate (SPEC I4a §7). */
    eventKind: varchar('event_kind', { length: 40 }),

    // Clustering embedding (empty until I3).
    embedding: vector('embedding', { dimensions: EMBEDDING_DIM }),

    ...timestamps(),
  },
  (t) => [
    index('articles_source_idx').on(t.sourceId),
    index('articles_publish_date_idx').on(t.publishDate),
    check('articles_body_only_ours', sql`${t.origin} = 'ours' OR ${t.body} IS NULL`),
  ],
);

/**
 * Article ↔ Topic — many-to-many, with exactly one PRIMARY topic per article
 * (BLUEPRINT 2.2). A partial unique index guarantees at most one primary link.
 */
export const articleTopics = pgTable(
  'article_topics',
  {
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.articleId, t.topicId] }),
    uniqueIndex('article_one_primary_topic')
      .on(t.articleId)
      .where(sql`${t.isPrimary}`),
  ],
);

/** Article ↔ Subject (games) — many-to-many (BLUEPRINT 2.2). */
export const articleSubjects = pgTable(
  'article_subjects',
  {
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.articleId, t.subjectId] })],
);
