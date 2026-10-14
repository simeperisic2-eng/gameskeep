import { sql } from 'drizzle-orm';
import {
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { BADGE_OVERRIDE_STATES, CURATION_LISTS, CURATION_PAGES } from '@gameskeep/shared/constants';
import { badges } from './lookups';
import { users } from './users';
import { primaryId, timestamps } from './_shared';

export const curationPageEnum = pgEnum('curation_page', CURATION_PAGES);
export const curationListEnum = pgEnum('curation_list', CURATION_LISTS);
export const badgeOverrideStateEnum = pgEnum('badge_override_state', BADGE_OVERRIDE_STATES);

/**
 * Editor curation of a COMPUTED list on a page (Phase P S3b): `pins` come first
 * in their order, `excludes` never show, the rest fills from the automatic list.
 * Keys are slugs (stories / games) or source slugs (coverage rows). One row per
 * (page kind, page, list); `discovery` uses page key "main".
 */
export const curation = pgTable(
  'curation',
  {
    id: primaryId(),
    pageKind: curationPageEnum('page_kind').notNull(),
    pageKey: varchar('page_key', { length: 160 }).notNull(),
    listKey: curationListEnum('list_key').notNull(),
    pins: text('pins')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    excludes: text('excludes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    note: text('note'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('curation_page_list_unique').on(t.pageKind, t.pageKey, t.listKey)],
);

/**
 * A staff badge decision (Phase P S3b): `granted` shows a badge the user did not
 * earn, `revoked` hides one they did. Applied when badges are read, so the
 * reputation job (which only ever adds earned badges) never undoes it.
 */
export const userBadgeOverrides = pgTable(
  'user_badge_overrides',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    badgeId: uuid('badge_id')
      .notNull()
      .references(() => badges.id, { onDelete: 'cascade' }),
    state: badgeOverrideStateEnum('state').notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('user_badge_overrides_unique').on(t.userId, t.badgeId)],
);

/**
 * A locked story's editor fields across a FULL re-cluster (Phase P S3b — the
 * hygiene-3 carry-over, extended to stories). Keyed on the story's member
 * articles (feed guids): after the re-cluster the new story that holds most of
 * them inherits the locked fields and the slug (so links + pins keep working).
 */
export const topicEditorialCarryover = pgTable('topic_editorial_carryover', {
  id: primaryId(),
  slug: varchar('slug', { length: 200 }).notNull(),
  memberGuids: text('member_guids')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  lockedFields: text('locked_fields')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  fields: jsonb('fields').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
