import { timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Column helpers reused across tables. Each is a FACTORY (returns fresh column
 * builders) because Drizzle mutates a builder with its column name — sharing a
 * single builder instance across tables would corrupt it.
 */

/** Standard UUID primary key (`gen_random_uuid()`, built into Postgres 16). */
export const primaryId = () => uuid('id').defaultRandom().primaryKey();

/** Created/updated timestamps; `updated_at` is bumped on every app-side update. */
export const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
