import {
  boolean,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { awardOutcomeTypeEnum, awardPhaseEnum } from './enums';
import { awardCategories } from './lookups';
import { subjects } from './subjects';
import { users } from './users';
import { primaryId, timestamps } from './_shared';

/**
 * Awards (annual) — BLUEPRINT 2.7. Edition → (edition-)Categories → Nominations
 * → Outcomes. Categories are a reusable extensible catalog (lookups.ts);
 * `award_edition_categories` selects which run in a given edition and carries
 * the sponsor slot. Dual outcome per category (Critics' Choice + Community
 * Choice) is modeled as separate `award_outcomes` rows to avoid an FK cycle.
 * Voting LOGIC is I7 — here we only model the structure.
 */
export const awardEditions = pgTable('award_editions', {
  id: primaryId(),
  year: integer('year').notNull().unique(),
  name: varchar('name', { length: 300 }).notNull(),
  phase: awardPhaseEnum('phase').notNull().default('announce'),
  description: text('description'),
  votingOpensAt: timestamp('voting_opens_at', { withTimezone: true }),
  votingClosesAt: timestamp('voting_closes_at', { withTimezone: true }),
  isPublished: boolean('is_published').notNull().default(false),
  ...timestamps(),
});

/** Which categories run in an edition (+ per-category sponsor slot). */
export const awardEditionCategories = pgTable(
  'award_edition_categories',
  {
    id: primaryId(),
    editionId: uuid('edition_id')
      .notNull()
      .references(() => awardEditions.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => awardCategories.id, { onDelete: 'restrict' }),
    sponsorSlotLabel: varchar('sponsor_slot_label', { length: 120 }),
    sponsorSold: boolean('sponsor_sold').notNull().default(false),
    sort: integer('sort').notNull().default(0),
    ...timestamps(),
  },
  (t) => [uniqueIndex('award_edition_category_unique').on(t.editionId, t.categoryId)],
);

/** Nominated subjects (games now) within an edition-category. */
export const awardNominations = pgTable(
  'award_nominations',
  {
    id: primaryId(),
    editionCategoryId: uuid('edition_category_id')
      .notNull()
      .references(() => awardEditionCategories.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    blurb: text('blurb'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('award_nomination_unique').on(t.editionCategoryId, t.subjectId)],
);

/** Critics' Choice + Community Choice winners, separate per edition-category. */
export const awardOutcomes = pgTable(
  'award_outcomes',
  {
    id: primaryId(),
    editionCategoryId: uuid('edition_category_id')
      .notNull()
      .references(() => awardEditionCategories.id, { onDelete: 'cascade' }),
    outcomeType: awardOutcomeTypeEnum('outcome_type').notNull(),
    nominationId: uuid('nomination_id')
      .notNull()
      .references(() => awardNominations.id, { onDelete: 'cascade' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('award_outcome_unique').on(t.editionCategoryId, t.outcomeType)],
);

/** Community votes (structure only; tallying + weighting logic is I7). */
export const awardVotes = pgTable(
  'award_votes',
  {
    id: primaryId(),
    editionCategoryId: uuid('edition_category_id')
      .notNull()
      .references(() => awardEditionCategories.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    nominationId: uuid('nomination_id')
      .notNull()
      .references(() => awardNominations.id, { onDelete: 'cascade' }),
    weight: real('weight').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('award_vote_one_per_category').on(t.editionCategoryId, t.userId)],
);
