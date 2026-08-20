import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { newsletterCampaignKindEnum, newsletterCampaignStatusEnum } from './enums';
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

/**
 * Newsletter campaigns (SPEC I8, Slice 3; BLUEPRINT 2.8). Staff compose a
 * campaign, pick a segment, and send it — the "send" fans out to the Mock
 * EmailSender (writes to `email_outbox`, ZERO network). There is NO real
 * dispatcher and NO new AI: a `digest` body is assembled from the EXISTING
 * topic summaries (`topics.tldr`/`ai_summary`).
 *
 * `body` is plain text sent as a plain-text email (no HTML/UGC → no injection
 * surface). The audience is resolved at SEND time from `newsletter_subscriptions`
 * with a GDPR gate (active + not-withdrawn only); we store the resolved
 * `recipientCount` for the record, never a per-recipient list here. Opens/clicks
 * are structural (0 in demo — no tracking pixel); `growth` analytics come from
 * the real subscription timeline. Every create/edit/send is audit-logged.
 */
export const newsletterCampaigns = pgTable(
  'newsletter_campaigns',
  {
    id: primaryId(),
    subject: varchar('subject', { length: 200 }).notNull(),
    // Optional inbox-preview line (the "preheader").
    preheader: varchar('preheader', { length: 200 }),
    // Plain-text body (rendered escaped; emailed as text/plain).
    body: text('body').notNull(),
    // 'all' or a subscription `source` label — the segment targeted at send.
    segment: varchar('segment', { length: 40 }).notNull().default('all'),
    kind: newsletterCampaignKindEnum('kind').notNull().default('manual'),
    status: newsletterCampaignStatusEnum('status').notNull().default('draft'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    // Resolved consented-audience size at send time (aggregate — no PII list).
    recipientCount: integer('recipient_count').notNull().default(0),
    // Structural engagement counters (0 in demo — no per-user tracking).
    opens: integer('opens').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    // The staff account that created it (loose pointer; audit log is authoritative).
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    index('newsletter_campaign_status_idx').on(t.status),
    index('newsletter_campaign_created_idx').on(t.createdAt),
  ],
);
