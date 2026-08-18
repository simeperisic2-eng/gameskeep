import {
  boolean,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { primaryId, timestamps } from './_shared';

/**
 * Newsletter / notification subscriptions (SPEC I7, Slice 2; BLUEPRINT 2.8). The
 * site-wide "subscribe" capture — the Awards "notify me" is the first `source`.
 *
 * Marketing is a SEPARATE GDPR consent from registration, so opt-in is EXPLICIT
 * (the API rejects a subscribe without consent) and every capture stamps the
 * marketing-consent VERSION + a COARSENED ip — the same discipline as
 * `user_consents`. A REGISTERED subscriber additionally gets a canonical
 * `user_consents` kind='marketing' row (the per-user ledger); an ANONYMOUS
 * subscriber (no account) gets the SAME treatment carried on THIS row (versioned
 * opt-in, coarsened ip, per-row unsubscribe token). The email is PII: the
 * account-deletion flow scrubs any row tied to the deleted user. Real sending is
 * delegated to a provider in I8 — here we only capture + let people unsubscribe.
 */
export const newsletterSubscriptions = pgTable(
  'newsletter_subscriptions',
  {
    id: primaryId(),
    // Stored lower-cased; one subscription per address (unique below).
    email: varchar('email', { length: 320 }).notNull(),
    // Set when a signed-in user subscribes (null for anonymous).
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    source: varchar('source', { length: 40 }).notNull().default('awards'),
    // The marketing-consent version accepted at opt-in (GDPR: prove WHAT they agreed to).
    consentVersion: varchar('consent_version', { length: 40 }).notNull(),
    active: boolean('active').notNull().default(true),
    ip: varchar('ip', { length: 45 }), // coarsened, GDPR-lean (same rule as sessions/consents)
    // Unguessable capability for the (login-free) unsubscribe link.
    unsubscribeToken: varchar('unsubscribe_token', { length: 64 }).notNull(),
    unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('newsletter_sub_email_unique').on(t.email),
    uniqueIndex('newsletter_sub_token_unique').on(t.unsubscribeToken),
    index('newsletter_sub_active_idx').on(t.active),
  ],
);
