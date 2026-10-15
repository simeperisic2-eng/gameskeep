import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { primaryId } from './_shared';

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

/**
 * The site-search index (Phase P S4) — one row per searchable game, story and
 * source, rebuilt set-based by a background job (boot, ingest, catalog import,
 * admin edits). The query hits only this table: full-text (`tsv`, GIN) with a
 * prefix on the last word, and a trigram fallback on `title_norm` for typos.
 * Visibility rules (hidden items, story categories) are applied at query time
 * from `hidden` + `category`, so a category's mode change needs no reindex.
 */
export const searchIndex = pgTable(
  'search_index',
  {
    id: primaryId(),
    entityType: varchar('entity_type', { length: 12 }).notNull(), // game | topic | source
    entityId: uuid('entity_id').notNull(),
    slug: varchar('slug', { length: 160 }).notNull(),
    title: varchar('title', { length: 300 }).notNull(),
    /** Lowercased, accent-free title (trigram + exact / prefix boosts). */
    titleNorm: text('title_norm').notNull(),
    /** A short context line (developer · year / outlet count / parent company). */
    subtitle: varchar('subtitle', { length: 300 }),
    /** Weighted document: title (A), alternate names (B), developer / publisher / tldr (C). */
    tsv: tsvector('tsv').notNull(),
    /** Stories only: the effective news category key (visibility at query time). */
    category: varchar('category', { length: 40 }),
    /** An editor's "hide from search". */
    hidden: boolean('hidden').notNull().default(false),
    sortDate: timestamp('sort_date', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('search_index_entity').on(t.entityType, t.entityId),
    index('search_index_tsv').using('gin', t.tsv),
    index('search_index_trgm').using('gin', sql`${t.titleNorm} gin_trgm_ops`),
  ],
);
