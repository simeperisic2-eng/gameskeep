import { boolean, integer, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { awardCategoryKindEnum } from './enums';
import { primaryId, timestamps } from './_shared';

/**
 * Extensible "content" lists, stored as DATA not enums (CLAUDE.md: "no
 * hardcoded lists ... all admin-editable and extensible"). Admins add/disable
 * values from the panel with zero code change.
 */

export const roles = pgTable('roles', {
  id: primaryId(),
  // Visitor / Registered / Writer / Moderator / Admin / Super-admin (BLUEPRINT 2.6).
  key: varchar('key', { length: 80 }).notNull().unique(),
  label: varchar('label', { length: 300 }).notNull(),
  /** Higher rank = more authority; used by permission checks later (I6/I8). */
  rank: integer('rank').notNull().default(0),
  isStaff: boolean('is_staff').notNull().default(false),
  sort: integer('sort').notNull().default(0),
  ...timestamps(),
});

export const userLevels = pgTable('user_levels', {
  id: primaryId(),
  // Newcomer → Contributor → Trusted → Veteran → Legend (earned; BLUEPRINT 2.6).
  key: varchar('key', { length: 80 }).notNull().unique(),
  label: varchar('label', { length: 300 }).notNull(),
  rank: integer('rank').notNull().default(0),
  sort: integer('sort').notNull().default(0),
  ...timestamps(),
});

export const topicTypes = pgTable('topic_types', {
  id: primaryId(),
  // Hot Topic, Trending, Legal Issues, Controversy, Release/Launch, ... (BLUEPRINT 2.1).
  key: varchar('key', { length: 80 }).notNull().unique(),
  label: varchar('label', { length: 300 }).notNull(),
  description: text('description'),
  sort: integer('sort').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps(),
});

export const sourceTypes = pgTable('source_types', {
  id: primaryId(),
  // mainstream / independent / industry / blog (BLUEPRINT 2.5).
  key: varchar('key', { length: 80 }).notNull().unique(),
  label: varchar('label', { length: 300 }).notNull(),
  sort: integer('sort').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps(),
});

export const badges = pgTable('badges', {
  id: primaryId(),
  // Verified, Top Reviewer, Early Voter, Trendsetter, Bias Hunter, ... (BLUEPRINT 2.6).
  key: varchar('key', { length: 80 }).notNull().unique(),
  label: varchar('label', { length: 300 }).notNull(),
  description: text('description'),
  iconUrl: text('icon_url'),
  sort: integer('sort').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps(),
});

export const awardCategories = pgTable('award_categories', {
  id: primaryId(),
  // GOTY, Best Narrative, Best Score & Music, ... + optional genre kinds (BLUEPRINT 2.7).
  key: varchar('key', { length: 80 }).notNull().unique(),
  label: varchar('label', { length: 300 }).notNull(),
  description: text('description'),
  kind: awardCategoryKindEnum('kind').notNull().default('general'),
  sort: integer('sort').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps(),
});
