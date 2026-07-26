import {
  boolean,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { userStatusEnum } from './enums';
import { badges, roles, userLevels } from './lookups';
import { primaryId, timestamps } from './_shared';

/**
 * User — BLUEPRINT 2.6. Two identity axes: an assigned **role** (prominent) and
 * an earned **level** (subtle). Auth itself is I6 — here we only model the
 * user/roles/badges tables (and seed a demo admin). `password_hash` and the
 * hidden internal level fields (vote_weight, level_points) exist now so I6 has
 * a home with no migration; the exact level formula stays hidden from users.
 */
export const users = pgTable('users', {
  id: primaryId(),
  username: varchar('username', { length: 32 }).notNull().unique(),
  email: varchar('email', { length: 254 }).notNull().unique(),
  displayName: varchar('display_name', { length: 80 }),
  avatarUrl: text('avatar_url'),
  bio: text('bio'),

  // Assigned role (restrict: a role in use cannot be deleted).
  roleId: uuid('role_id')
    .notNull()
    .references(() => roles.id, { onDelete: 'restrict' }),
  // Earned level (nullable; set null if the level row is removed).
  levelId: uuid('level_id').references(() => userLevels.id, { onDelete: 'set null' }),

  reputation: integer('reputation').notNull().default(0),
  isEmailVerified: boolean('is_email_verified').notNull().default(false),
  passwordHash: text('password_hash'), // filled by auth in I6

  // --- hidden internal fields (never shown to users) ---
  voteWeight: real('vote_weight').notNull().default(0), // 0 → 1.0, anti-abuse (I6)
  levelPoints: integer('level_points').notNull().default(0),

  status: userStatusEnum('status').notNull().default('active'),
  ...timestamps(),
});

/** Badges a user has earned (extensible badge catalog). */
export const userBadges = pgTable(
  'user_badges',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    badgeId: uuid('badge_id')
      .notNull()
      .references(() => badges.id, { onDelete: 'cascade' }),
    awardedAt: timestamp('awarded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.badgeId] })],
);
