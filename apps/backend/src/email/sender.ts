import { db } from '../db/client';
import { emailOutbox } from '../db/schema';
import type { EmailMessage } from './templates';

/**
 * The `EmailSender` seam (SPEC I6, Slice 2 — same dormant-until-production
 * shape as the game / article / Steam seams). Demo → Mock (writes to the
 * `email_outbox` dev mailbox, ZERO network); production → Live (a real
 * provider, dormant until wired — the key is prod-only anyway).
 */
export interface EmailSender {
  readonly name: 'mock' | 'live';
  send(message: EmailMessage, opts?: { relatedUserId?: string }): Promise<void>;
}

/**
 * Mock sender — the demo inbox. Every message becomes an `email_outbox` row
 * (status `sent`); the raw token in the link is thus visible to a developer
 * (that IS the demo verification/reset channel) but never leaves the DB. One
 * cheap INSERT, no network — safe to run inline on the request path.
 */
export const mockEmailSender: EmailSender = {
  name: 'mock',
  async send(message, opts) {
    await db.insert(emailOutbox).values({
      toEmail: message.toEmail,
      subject: message.subject,
      bodyText: message.bodyText,
      purpose: message.purpose,
      provider: 'mock',
      status: 'sent',
      relatedUserId: opts?.relatedUserId ?? null,
      sentAt: new Date(),
    });
  },
};

/**
 * Live sender — dormant. Wiring a provider (subject to its API key, which is
 * production-only) is an OWNER-TODO; until then reaching this in production
 * fails loudly rather than silently dropping mail. Production must also move
 * the actual dispatch off the request path (a queue), like the other live
 * integrations. [[OWNER-TODO: wire a transactional-email provider for prod]]
 */
export const liveEmailSender: EmailSender = {
  name: 'live',
  async send() {
    throw new Error(
      'Live email provider is not configured — set EMAIL_PROVIDER_API_KEY and wire a sender (ASSETS.md §3).',
    );
  },
};
