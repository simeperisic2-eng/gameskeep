import { boolean, index, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users';
import { primaryId } from './_shared';

/**
 * Versioned consent records (SPEC I6, Slice 7, GDPR). Each row is a point-in-time
 * capture of a user granting/withdrawing a consent (terms/privacy/analytics/
 * marketing) at a specific VERSION, with a COARSENED IP (same /24 + hextet-trim
 * rule as sessions — GDPR-lean, never the full address). Append-only history:
 * the newest row per (user, type) is the current stance. Hard-deleted on account
 * deletion (it is personal data); included verbatim in the data export.
 */
export const userConsents = pgTable(
  'user_consents',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    consentType: varchar('consent_type', { length: 40 }).notNull(),
    version: varchar('version', { length: 40 }).notNull(),
    granted: boolean('granted').notNull(),
    /** Coarsened client IP (last octet / tail hextets zeroed) — GDPR-lean. */
    ip: varchar('ip', { length: 45 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('user_consents_user_idx').on(t.userId, t.consentType)],
);
