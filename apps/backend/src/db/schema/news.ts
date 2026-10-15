import { sql } from 'drizzle-orm';
import { boolean, integer, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from './_shared';

/**
 * News categories (Phase P S4) — what KIND of piece an article is (news, review,
 * deals, guide, listicle, …), separate from the editorial topic types. Editors
 * own the list: each category has a DISPLAY MODE — `show` (everywhere), `low`
 * (only in "More from the feed"; never Trending / Latest / briefing counts) or
 * `hide` (out of every feed and count) — and the keyword phrases the mechanical
 * classifier matches (highest priority first). A feed-given article type wins.
 */
export const newsCategories = pgTable('news_categories', {
  id: primaryId(),
  key: varchar('key', { length: 40 }).notNull().unique(),
  label: varchar('label', { length: 60 }).notNull(),
  mode: varchar('mode', { length: 8 }).notNull().default('show'),
  keywords: text('keywords')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  priority: integer('priority').notNull().default(10),
  active: boolean('active').notNull().default(true),
  ...timestamps(),
});
