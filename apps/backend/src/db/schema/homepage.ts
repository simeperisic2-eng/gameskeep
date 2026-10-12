import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { HOMEPAGE_MAX_ITEMS, HOMEPAGE_SECTIONS } from '@gameskeep/shared/constants';
import { homepageSectionKindEnum, homepageSectionModeEnum } from './enums';
import { subjects } from './subjects';
import { primaryId, timestamps } from './_shared';

/**
 * Homepage sections (Phase P S2). One row per section of the fixed catalogue
 * (`HOMEPAGE_SECTIONS`): the KEY is the stable identity; the KIND (data /
 * discovery / block) is an informational label only since the owner decision
 * that any list may carry paid placements. Everything else is admin data: title,
 * enabled, order, mode, item count, minimum items, Δ window, card tags, feed
 * rules, and the positions of the PAID items (any number, admin-set).
 */
const keysOfKind = (kind: string): string =>
  Object.entries(HOMEPAGE_SECTIONS)
    .filter(([, d]) => d.kind === kind)
    .map(([k]) => `'${k}'`)
    .join(', ');
const deltaKeys = Object.entries(HOMEPAGE_SECTIONS)
  .filter(([, d]) => d.delta)
  .map(([k]) => `'${k}'`)
  .join(', ');

export const homepageSections = pgTable(
  'homepage_sections',
  {
    id: primaryId(),
    key: varchar('key', { length: 40 }).notNull().unique(),
    kind: homepageSectionKindEnum('kind').notNull(),
    title: varchar('title', { length: 80 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    position: integer('position').notNull().default(0),
    mode: homepageSectionModeEnum('mode').notNull().default('auto'),
    itemCount: smallint('item_count').notNull().default(6),
    /** Δ window (hours) — only sections that show a Δ (Trending, By players). */
    deltaWindowHours: integer('delta_window_hours'),
    /** Which tag families + how many tags a card shows (rendered once S3 tags exist). */
    cardTagFamilies: text('card_tag_families')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    cardTagCount: smallint('card_tag_count').notNull().default(0),
    /** Feed rules: { include?: {dimension: string[]}, exclude?: {…} } (validated on write). */
    rules: jsonb('rules')
      .notNull()
      .default(sql`'{}'::jsonb`),
    /**
     * 1-based positions where PAID items are inserted (owner decision: any list
     * may carry them; the count is the number of positions). Paid items are
     * INSERTED — the organic list keeps its items, order and numbers.
     */
    paidPositions: smallint('paid_positions')
      .array()
      .notNull()
      .default(sql`'{}'::smallint[]`),
    /** Below this many qualifying items the section is hidden (null = never). */
    minItems: smallint('min_items'),
    ...timestamps(),
  },
  () => [
    check(
      'homepage_sections_kind_by_key',
      sql.raw(
        `(key IN (${keysOfKind('data')}) AND kind = 'data') OR ` +
          `(key IN (${keysOfKind('discovery')}) AND kind = 'discovery') OR ` +
          `(key IN (${keysOfKind('block')}) AND kind = 'block')`,
      ),
    ),
    check(
      'homepage_sections_paid_positions',
      sql.raw(
        `cardinality(paid_positions) <= ${HOMEPAGE_MAX_ITEMS} AND 1 <= ALL (paid_positions) AND ${HOMEPAGE_MAX_ITEMS} >= ALL (paid_positions)`,
      ),
    ),
    check(
      'homepage_sections_min_items',
      sql.raw(`min_items IS NULL OR min_items BETWEEN 1 AND ${HOMEPAGE_MAX_ITEMS}`),
    ),
    check(
      'homepage_sections_item_count',
      sql.raw(`item_count BETWEEN 1 AND ${HOMEPAGE_MAX_ITEMS}`),
    ),
    check(
      'homepage_sections_delta_window',
      sql.raw(
        `delta_window_hours IS NULL OR (key IN (${deltaKeys}) AND delta_window_hours BETWEEN 1 AND 2160)`,
      ),
    ),
    check('homepage_sections_card_tags', sql.raw('card_tag_count BETWEEN 0 AND 10')),
  ],
);

/**
 * Editorial pins: an item held at an explicit position (auto fills the rest).
 * There is NO paid column — an editorial pin can never carry the Promoted label
 * (separate mechanisms). Stories are pinned by SLUG (a re-cluster recreates topic
 * rows; the slug is the identity that survives), games by subject.
 */
export const homepageSectionPins = pgTable(
  'homepage_section_pins',
  {
    id: primaryId(),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => homepageSections.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    topicSlug: varchar('topic_slug', { length: 200 }),
    subjectId: uuid('subject_id').references(() => subjects.id, { onDelete: 'cascade' }),
    createdByLabel: varchar('created_by_label', { length: 120 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('homepage_pins_position').on(t.sectionId, t.position),
    uniqueIndex('homepage_pins_topic')
      .on(t.sectionId, t.topicSlug)
      .where(sql`topic_slug IS NOT NULL`),
    uniqueIndex('homepage_pins_subject')
      .on(t.sectionId, t.subjectId)
      .where(sql`subject_id IS NOT NULL`),
    check('homepage_pins_one_target', sql`num_nonnulls(topic_slug, subject_id) = 1`),
    check('homepage_pins_position_range', sql.raw(`position BETWEEN 1 AND ${HOMEPAGE_MAX_ITEMS}`)),
  ],
);

/**
 * Pre-computed section contents (the snapshots job). The homepage reads ONLY
 * these — ranking, Δ windows and credibility weighting never run on a request.
 */
export const homepageSectionSnapshots = pgTable(
  'homepage_section_snapshots',
  {
    sectionKey: varchar('section_key', { length: 40 }).primaryKey(),
    payload: jsonb('payload').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('homepage_snapshots_computed_idx').on(t.computedAt)],
);
