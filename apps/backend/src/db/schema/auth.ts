import { index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users';
import { primaryId } from './_shared';

/**
 * Auth tables (SPEC I6, Slice 1 — sessions-not-JWT, locked decision 1).
 *
 * `sessions` holds ONLY the SHA-256 hash of the opaque 256-bit token — the raw
 * token exists solely in the signed HttpOnly cookie. Hash-at-rest means a DB
 * leak yields nothing replayable; server-side rows mean instant revocation
 * (logout / logout-everywhere / ban / password change) and a clean GDPR
 * cascade (delete user → sessions go with it).
 *
 * Expiry is SLIDING (`expiresAt` advances on activity) under a HARD ABSOLUTE
 * CAP (`absoluteExpiresAt`, +90 days from creation) — a session can never
 * outlive the cap no matter how active it is.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 hex of the raw token. NEVER the raw token itself. */
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    /** Coarsened client IP (last octet / tail hextets zeroed) — GDPR-lean. */
    ip: varchar('ip', { length: 45 }),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** Sliding expiry — advances on activity, never past the absolute cap. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Hard cap — createdAt + 90 days. The session dies here regardless. */
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
);
