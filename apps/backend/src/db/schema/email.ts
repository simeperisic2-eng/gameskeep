import { index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { primaryId } from './_shared';

/**
 * Outbound email log / dev mailbox (SPEC I6, Slice 2 — the `EmailSender` seam).
 *
 * The Mock sender (demo) writes every message here and does ZERO network I/O —
 * this table IS the demo inbox (verification links, reset links, "account
 * exists" notices all land here). The Live sender (dormant until a provider is
 * wired) would dispatch off the request path and mark rows sent/failed.
 *
 * This is an operational log, NOT relational content: `relatedUserId` is a
 * plain nullable pointer (no FK cascade) so a row survives independently; the
 * GDPR slice purges a user's rows by email. It holds NO secret — never the
 * provider API key, never a password hash; the raw token lives only in the
 * link inside `bodyText` (that is the whole point of a mailbox) and is never
 * echoed to any API payload or served HTML.
 */
export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: primaryId(),
    toEmail: varchar('to_email', { length: 254 }).notNull(),
    subject: varchar('subject', { length: 300 }).notNull(),
    bodyText: text('body_text').notNull(),
    /** verify_email | password_reset | account_exists | … */
    purpose: varchar('purpose', { length: 40 }).notNull(),
    /** mock | live — which sender produced this row. */
    provider: varchar('provider', { length: 20 }).notNull(),
    /** sent | pending | failed. Mock writes `sent` (delivered to this mailbox). */
    status: varchar('status', { length: 20 }).notNull().default('sent'),
    error: text('error'),
    /** Loose pointer to the related account (no FK — this is a log). */
    relatedUserId: uuid('related_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [
    index('email_outbox_to_idx').on(t.toEmail),
    index('email_outbox_created_idx').on(t.createdAt),
  ],
);
