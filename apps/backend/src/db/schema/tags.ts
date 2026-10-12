import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  GAME_TAG_SOURCES,
  GAME_TAG_STATES,
  TAG_FAMILIES,
  TAG_SUGGESTION_SOURCES,
  TAG_SUGGESTION_STATUSES,
} from '@gameskeep/shared/constants';
import { games } from './games';
import { users } from './users';
import { primaryId, timestamps } from './_shared';

export const tagFamilyEnum = pgEnum('tag_family', TAG_FAMILIES);
export const gameTagStateEnum = pgEnum('game_tag_state', GAME_TAG_STATES);
export const gameTagSourceEnum = pgEnum('game_tag_source', GAME_TAG_SOURCES);
export const tagSuggestionStatusEnum = pgEnum('tag_suggestion_status', TAG_SUGGESTION_STATUSES);
export const tagSuggestionSourceEnum = pgEnum('tag_suggestion_source', TAG_SUGGESTION_SOURCES);

/**
 * The tag taxonomy (Phase P S3). Editors own it entirely — no built-in content
 * restriction (owner). `aliases` map other spellings (imports, suggestions) onto
 * a tag; `intro` is the tag page's short text. A retired tag (`active` false)
 * disappears from voting, filters and tag pages but keeps its history.
 */
export const tags = pgTable(
  'tags',
  {
    id: primaryId(),
    family: tagFamilyEnum('family').notNull(),
    slug: varchar('slug', { length: 160 }).notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    intro: text('intro'),
    aliases: text('aliases')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    active: boolean('active').notNull().default(true),
    sort: integer('sort').notNull().default(0),
    ...timestamps(),
  },
  (t) => [uniqueIndex('tags_slug_unique').on(t.slug), index('tags_family_idx').on(t.family)],
);

/**
 * A tag ON a game. `pending` waits in the moderation queue; `published` is public;
 * `rejected` is a tombstone (an editor removed it — imports and votes never bring
 * it back by themselves). The publication gate: a player-reported tag needs its
 * credibility-weighted score ≥ the threshold AND an editor's confirmation;
 * editors may also publish directly (`source` editors). Issue lifecycle fields:
 * first seen, last confirmed (an editor), last fresh vote, resolved + patch.
 */
export const gameTags = pgTable(
  'game_tags',
  {
    id: primaryId(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    state: gameTagStateEnum('state').notNull().default('pending'),
    source: gameTagSourceEnum('source').notNull(),
    /** Σ credibility of the counted votes (votes below the floor count 0). */
    weightedScore: real('weighted_score').notNull().default(0),
    voteCount: integer('vote_count').notNull().default(0),
    /** Vote spike made mostly of low-credibility accounts (the anomaly flag). */
    flagged: boolean('flagged').notNull().default(false),
    flagInfo: jsonb('flag_info'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastVoteAt: timestamp('last_vote_at', { withTimezone: true }),
    lastConfirmedAt: timestamp('last_confirmed_at', { withTimezone: true }),
    confirmedByUserId: uuid('confirmed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    confirmedByLabel: varchar('confirmed_by_label', { length: 120 }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    patchRef: varchar('patch_ref', { length: 120 }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('game_tags_game_tag_unique').on(t.gameId, t.tagId),
    index('game_tags_tag_state_idx').on(t.tagId, t.state),
    index('game_tags_state_idx').on(t.state),
    // Resolved ⇒ a patch / version reference is on record.
    check('game_tags_resolved_patch', sql`${t.resolvedAt} IS NULL OR ${t.patchRef} IS NOT NULL`),
    check('game_tags_score_nonneg', sql`${t.weightedScore} >= 0 AND ${t.voteCount} >= 0`),
  ],
);

/** One vote per user per tag per game; deleting the row withdraws it. */
export const gameTagVotes = pgTable(
  'game_tag_votes',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('game_tag_votes_unique').on(t.userId, t.gameId, t.tagId),
    index('game_tag_votes_game_tag_idx').on(t.gameId, t.tagId),
  ],
);

/**
 * New tag NAMES — from readers or unmatched imported tags. Never live: an editor
 * accepts (a new taxonomy tag), merges (an alias of an existing one) or rejects.
 */
export const tagSuggestions = pgTable(
  'tag_suggestions',
  {
    id: primaryId(),
    rawName: varchar('raw_name', { length: 120 }).notNull(),
    normalized: varchar('normalized', { length: 120 }).notNull(),
    gameId: uuid('game_id').references(() => games.id, { onDelete: 'cascade' }),
    source: tagSuggestionSourceEnum('source').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    status: tagSuggestionStatusEnum('status').notNull().default('pending'),
    mergedIntoTagId: uuid('merged_into_tag_id').references(() => tags.id, {
      onDelete: 'set null',
    }),
    attempts: smallint('attempts').notNull().default(1),
    decidedByLabel: varchar('decided_by_label', { length: 120 }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('tag_suggestions_status_idx').on(t.status),
    uniqueIndex('tag_suggestions_pending_unique')
      .on(t.normalized, t.gameId)
      .where(sql`${t.status} = 'pending'`),
  ],
);
