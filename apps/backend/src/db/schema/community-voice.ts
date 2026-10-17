import { sql } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from './_shared';
import { games } from './games';
import { users } from './users';

/**
 * Phase P S5 — community voice.
 *
 * `game_community_notes`: the editor note "What the community says" (2–3
 * sentences, at least one source link, as-of date, editor name). One per game;
 * every save / polish / publish is audited (both texts). Only `published` shows.
 * The draft and the published copy are separate (editing never changes what
 * readers see until it is published again). The AI polish candidate waits here with the validator's verdict until the
 * editor accepts or discards it — the editor publishes, never the AI.
 */
export const gameCommunityNotes = pgTable(
  'game_community_notes',
  {
    id: primaryId(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 12 }).notNull().default('draft'),
    text: text('text').notNull().default(''),
    sources: jsonb('sources')
      .$type<{ url: string; label?: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    asOf: varchar('as_of', { length: 10 }),
    // The PUBLISHED copy — what readers see. Editing the draft never changes it
    // until an editor publishes again.
    publishedText: text('published_text'),
    publishedSources: jsonb('published_sources').$type<{ url: string; label?: string }[]>(),
    publishedAsOf: varchar('published_as_of', { length: 10 }),
    /** Who published it (shown publicly as the editor name). */
    editorUserId: uuid('editor_user_id').references(() => users.id, { onDelete: 'set null' }),
    editorLabel: varchar('editor_label', { length: 120 }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    // The pending AI polish (or a rewrite pasted from elsewhere) + the validator verdict.
    polishOriginal: text('polish_original'),
    polishCandidate: text('polish_candidate'),
    polishOk: boolean('polish_ok'),
    polishIssues: jsonb('polish_issues').$type<{ kind: string; token: string }[]>(),
    polishProvider: varchar('polish_provider', { length: 40 }),
    polishedAt: timestamp('polished_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [uniqueIndex('game_community_notes_game_unique').on(t.gameId)],
);

/**
 * `game_steam_review_summaries`: the AI summary of a game's recent Steam reviews
 * + the stats beside it. NO reviewer data is stored (names / ids are stripped
 * before the AI call and never persisted). Editor overrides: hide, edit (the text
 * becomes editorial) or approve the automatic text (editorial until the next
 * automatic text differs).
 */
export const gameSteamReviewSummaries = pgTable(
  'game_steam_review_summaries',
  {
    id: primaryId(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    reviewCount: integer('review_count').notNull().default(0),
    positivePct: real('positive_pct'),
    windowDays: smallint('window_days').notNull().default(30),
    /** The automatic (AI) summary; null when there was nothing safe to say. */
    summaryText: text('summary_text'),
    /** An editor's own text — wins over the automatic one. */
    editedText: text('edited_text'),
    approvedByLabel: varchar('approved_by_label', { length: 120 }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    hidden: boolean('hidden').notNull().default(false),
    provider: varchar('provider', { length: 20 }),
    computedAt: timestamp('computed_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [uniqueIndex('game_steam_review_summaries_game_unique').on(t.gameId)],
);

/**
 * `critic_feed_decisions`: "not a scored review" for an ingested outlet article,
 * keyed on the feed guid (survives a full re-cluster).
 */
export const criticFeedDecisions = pgTable('critic_feed_decisions', {
  articleGuid: varchar('article_guid', { length: 400 }).primaryKey(),
  decision: varchar('decision', { length: 16 }).notNull().default('dismissed'),
  note: text('note'),
  decidedByLabel: varchar('decided_by_label', { length: 120 }),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
});
