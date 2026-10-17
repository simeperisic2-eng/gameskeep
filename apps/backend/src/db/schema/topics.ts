import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
  varchar,
  vector,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { EMBEDDING_DIM, type TopicBiasDistribution } from '@gameskeep/shared/constants';
import { topicStatusEnum } from './enums';
import { topicTypes } from './lookups';
import { subjects } from './subjects';
import { primaryId, timestamps } from './_shared';

/**
 * Topic (Story) — the top of the news hierarchy (BLUEPRINT 1.4, 2.1). Articles
 * from many sources gather around a Topic. The two PUBLIC bias axes are
 * DERIVED/aggregated from the topic's articles (computed in I4) — we leave
 * nullable `derived_*` columns rather than storing editable values. The
 * embedding column is created now (empty) so clustering in I3 needs no migration.
 */
export const topics = pgTable(
  'topics',
  {
    id: primaryId(),
    slug: varchar('slug', { length: 160 }).notNull().unique(),
    title: varchar('title', { length: 300 }).notNull(),
    tldr: varchar('tldr', { length: 400 }),
    aiSummary: text('ai_summary'),
    status: topicStatusEnum('status').notNull().default('developing'),
    // Extensible topic type (Hot Topic / Trending / Legal Issues / ...).
    typeId: uuid('type_id').references(() => topicTypes.id, { onDelete: 'set null' }),

    // Clustering embedding (empty until I3).
    embedding: vector('embedding', { dimensions: EMBEDDING_DIM }),

    // Derived bias aggregates (computed in I4a). `derived_*_pct` keep the simple
    // axis averages; `bias_distribution` is the full per-axis distribution the
    // I5 bias bar renders (counts + averages), computed off the request path.
    derivedInfluencePct: real('derived_influence_pct'),
    derivedQualityPct: real('derived_quality_pct'),
    biasDistribution: jsonb('bias_distribution').$type<TopicBiasDistribution>(),

    // Secondary-gate seed fields (SPEC I4a §7): the originating event's primary
    // game (normalized name) + event kind, set when the topic is created. The
    // gate compares an incoming article against these to resist same-game/
    // different-event over-merges. Denormalized so the gate needs no mid-cluster
    // subject resolution.
    seedGameRef: varchar('seed_game_ref', { length: 200 }),
    seedEventKind: varchar('seed_event_kind', { length: 40 }),

    /**
     * Phase P S3b: fields an editor edited — the automatic passes (status by
     * article count, the stale → resolved sweep, the AI TL;DR / summary refresh)
     * and a full re-cluster leave them as the editor set them. Unlock = remove.
     */
    lockedFields: text('locked_fields')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /**
     * Phase P S4: indexing — 'auto' (the rule: enough sources, or an AI summary
     * and a linked game), or an editor's 'index' / 'noindex'.
     */
    seoIndex: varchar('seo_index', { length: 8 }).notNull().default('auto'),
    /** Phase P S4: the story's news category (computed from its articles; an edit locks it). */
    category: varchar('category', { length: 40 }),
    /** Phase P S4: an editor keeps this story out of site search. */
    searchHidden: boolean('search_hidden').notNull().default(false),
    /**
     * Phase P S5 (EU AI Act transparency): the automatic TL;DR / AI summary carry a
     * visible "AI summary" label until an editor edits or approves the text — then
     * it is editorial (who + when kept here). A later automatic regeneration clears it.
     */
    tldrApprovedByLabel: varchar('tldr_approved_by_label', { length: 120 }),
    tldrApprovedAt: timestamp('tldr_approved_at', { withTimezone: true }),
    aiSummaryApprovedByLabel: varchar('ai_summary_approved_by_label', { length: 120 }),
    aiSummaryApprovedAt: timestamp('ai_summary_approved_at', { withTimezone: true }),

    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [index('topics_status_idx').on(t.status)],
);

/** Topic ↔ Subject — many-to-many (BLUEPRINT 1.4). */
export const topicSubjects = pgTable(
  'topic_subjects',
  {
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.topicId, t.subjectId] })],
);

/** Related topics — self many-to-many (same game / similar event). */
export const relatedTopics = pgTable(
  'related_topics',
  {
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    relatedTopicId: uuid('related_topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.topicId, t.relatedTopicId] }),
    // A topic cannot be related to itself.
    check('related_topics_not_self', sql`${t.topicId} <> ${t.relatedTopicId}`),
  ],
);

/** Chronological timeline for Developing topics (BLUEPRINT 2.1). */
export const topicTimelineEvents = pgTable(
  'topic_timeline_events',
  {
    id: primaryId(),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    label: varchar('label', { length: 300 }).notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('topic_timeline_topic_idx').on(t.topicId)],
);
