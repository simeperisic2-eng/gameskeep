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
import { games } from './games';
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

/**
 * Comment reports (SPEC I6, Slice 4, decision 8) — a user flags a comment. One
 * report per user per comment (the unique index); when the DISTINCT report
 * count crosses the `app_settings.community.autoHideReports` threshold the
 * comment is auto-hidden (`comments.isRemoved = true`) pending moderator review
 * (restore is a moderator action; the full dashboard is I8).
 */
export const commentReports = pgTable(
  'comment_reports',
  {
    id: primaryId(),
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    reporterUserId: uuid('reporter_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reason: varchar('reason', { length: 300 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('comment_report_unique').on(t.commentId, t.reporterUserId)],
);

/**
 * Upcoming-game hype votes (SPEC I6, Slice 4) — the "▲ Hype" toggle on upcoming
 * titles. A one-per-user presence flag (no value); the count is the hype level.
 * Like every community signal it is credibility-weighted at read (decision 13),
 * so a throwaway's hype counts ~0 and a proven account's ~1.0.
 */
export const gameHypeVotes = pgTable(
  'game_hype_votes',
  {
    id: primaryId(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('game_hype_vote_unique').on(t.gameId, t.userId)],
);

/**
 * Follows (SPEC I6, Slice 6, decision 9) — a user follows a GAME or a TOPIC to
 * build a personal "Your Feed". Polymorphic (entity_type + id, like comments),
 * one row per (user, entity). Following is allowed for UNVERIFIED users
 * (decision 6: browse + follow are open; only writes need a verified email).
 * Notification delivery is deferred to I8 — this is the follow graph + feed only.
 */
export const follows = pgTable(
  'follows',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    entityType: varchar('entity_type', { length: 20 }).notNull(), // game | topic
    entityId: uuid('entity_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('follow_unique').on(t.userId, t.entityType, t.entityId),
    index('follows_user_idx').on(t.userId),
  ],
);
