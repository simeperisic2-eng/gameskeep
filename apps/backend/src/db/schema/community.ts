import {
  boolean,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { articles } from './articles';
import { topics } from './topics';
import { users } from './users';
import { primaryId } from './_shared';

/**
 * Community interaction tables — comments, reactions, trust/bias votes.
 *
 * SCHEMA ROOM ONLY. BLUEPRINT 2.1/2.2 say these exist "from the start", so the
 * tables (and their one-per-user uniqueness) are defined here to avoid a
 * retrofit. The actual flows, weighting and moderation are built in I6 (users)
 * and I8 (moderation); I1 exposes NO admin CRUD or logic for them.
 *
 * `comments` and `reactions` are polymorphic over entity types
 * (topic | article | game) — kept as text + id rather than many FK columns.
 */
export const comments = pgTable(
  'comments',
  {
    id: primaryId(),
    entityType: varchar('entity_type', { length: 20 }).notNull(), // topic | article | game
    entityId: uuid('entity_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    body: text('body').notNull(),
    isRemoved: boolean('is_removed').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('comments_entity_idx').on(t.entityType, t.entityId)],
);

export const reactions = pgTable(
  'reactions',
  {
    id: primaryId(),
    entityType: varchar('entity_type', { length: 20 }).notNull(),
    entityId: uuid('entity_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 40 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('reaction_unique').on(t.entityType, t.entityId, t.userId, t.kind)],
);

/** Article trust vote — "felt honest" vs "felt like paid hype" (BLUEPRINT 2.2). */
export const articleTrustVotes = pgTable(
  'article_trust_votes',
  {
    id: primaryId(),
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    value: smallint('value').notNull(), // +1 honest / -1 paid-hype
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('article_trust_vote_unique').on(t.articleId, t.userId)],
);

/** Topic-level influence/quality/trust votes — one per user per axis (BLUEPRINT 2.1). */
export const topicBiasVotes = pgTable(
  'topic_bias_votes',
  {
    id: primaryId(),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    axis: varchar('axis', { length: 20 }).notNull(), // influence | quality | trust
    value: smallint('value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('topic_bias_vote_unique').on(t.topicId, t.userId, t.axis)],
);
