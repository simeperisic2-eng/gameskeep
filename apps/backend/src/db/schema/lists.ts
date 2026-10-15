import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { articles } from './articles';
import { games } from './games';
import { sources } from './sources';
import { primaryId, timestamps } from './_shared';

/**
 * Editorial lists (Phase P S4) — outlets' official year-end lists (Game of the
 * Year, best games of the year…), a content type separate from news. Ingest only
 * files list-like articles as CANDIDATES; editors confirm, reject, or add lists by
 * hand (outlet + link required). Only CONFIRMED lists are ever public, and never
 * as a copy of the outlet's list: public surfaces show the consensus, per-game
 * positions, comparison lines and a link out. The full entries stay in admin.
 */
export const editorialListCategories = pgTable('editorial_list_categories', {
  id: primaryId(),
  key: varchar('key', { length: 40 }).notNull().unique(),
  label: varchar('label', { length: 80 }).notNull(),
  sort: integer('sort').notNull().default(0),
  active: boolean('active').notNull().default(true),
  ...timestamps(),
});

export const editorialLists = pgTable(
  'editorial_lists',
  {
    id: primaryId(),
    /** candidate | confirmed | rejected — a decision is never reverted by ingest. */
    status: varchar('status', { length: 12 }).notNull().default('candidate'),
    /** The feed article it was detected on (null after a reset until relinked by guid). */
    articleId: uuid('article_id').references(() => articles.id, { onDelete: 'set null' }),
    /** Identity across a re-cluster (the article row is recreated). */
    externalGuid: varchar('external_guid', { length: 400 }),
    sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
    outletName: varchar('outlet_name', { length: 200 }).notNull(),
    title: varchar('title', { length: 300 }).notNull(),
    /** The original list — every public mention links here. */
    url: text('url'),
    year: integer('year'),
    categoryKey: varchar('category_key', { length: 40 }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    /** auto (ingest) | editor (added by hand). */
    detectedBy: varchar('detected_by', { length: 10 }).notNull().default('auto'),
    decidedByLabel: varchar('decided_by_label', { length: 120 }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    notes: text('notes'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('editorial_lists_guid').on(t.externalGuid),
    index('editorial_lists_status').on(t.status),
    index('editorial_lists_year_category').on(t.year, t.categoryKey),
  ],
);

export const editorialListEntries = pgTable(
  'editorial_list_entries',
  {
    id: primaryId(),
    listId: uuid('list_id')
      .notNull()
      .references(() => editorialLists.id, { onDelete: 'cascade' }),
    rank: integer('rank').notNull(),
    rawName: varchar('raw_name', { length: 300 }).notNull(),
    gameId: uuid('game_id').references(() => games.id, { onDelete: 'set null' }),
    /** auto (the matcher) | editor (a staff decision) | unmatched. */
    match: varchar('match', { length: 12 }).notNull().default('unmatched'),
    ...timestamps(),
  },
  (t) => [
    index('editorial_list_entries_list').on(t.listId),
    index('editorial_list_entries_game').on(t.gameId),
  ],
);

/**
 * The computed consensus per (year, category) — written by the lists job, read
 * by the public pages (nothing computed on the request). Every game with at least
 * one appearance has a row (its comparison lines feed the game page); only rows
 * with `inConsensus` (≥ the minimum appearances) appear on the consensus page.
 */
export const editorialListConsensus = pgTable(
  'editorial_list_consensus',
  {
    id: primaryId(),
    year: integer('year').notNull(),
    categoryKey: varchar('category_key', { length: 40 }).notNull(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    appearances: integer('appearances').notNull(),
    avgRank: numeric('avg_rank', { precision: 6, scale: 2 }).notNull(),
    bestRank: integer('best_rank').notNull(),
    worstRank: integer('worst_rank').notNull(),
    /** Position on the consensus (null when not in it). */
    position: integer('position'),
    inConsensus: boolean('in_consensus').notNull().default(false),
    /** [{ listId, outlet, rank, url }] — this game's positions. */
    positions: jsonb('positions')
      .$type<{ listId: string; outlet: string; rank: number; url: string | null }[]>()
      .notNull(),
    /** [{ key, text }] — computed comparison lines (data only). */
    lines: jsonb('lines').$type<{ key: string; text: string }[]>().notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('editorial_list_consensus_key').on(t.year, t.categoryKey, t.gameId),
    index('editorial_list_consensus_game').on(t.gameId),
  ],
);
