import { isProduction } from '../config/env';
import type { EmailSender } from './sender';
import { mockEmailSender, liveEmailSender } from './sender';

/**
 * The ONE switch point for the email seam (same pattern as the other seams):
 * demo → mock (dev mailbox, no network), production → the live provider.
 */
export function getEmailSender(): EmailSender {
  return isProduction() ? liveEmailSender : mockEmailSender;
}

export interface EmailSenderStatus {
  provider: 'mock' | 'live';
  live: boolean;
  description: string;
}

/** Human/observable description of the active sender (readiness + verify). */
export function describeEmailSender(): EmailSenderStatus {
  const sender = getEmailSender();
  const live = sender.name === 'live';
  return {
    provider: sender.name,
    live,
    description: live
      ? 'Live email provider — dispatch off the request path (dormant until a provider is wired).'
      : 'Mock email sender — messages land in the email_outbox dev mailbox; no network, no secrets.',
  };
}

export type { EmailSender } from './sender';
export type { EmailMessage, EmailPurpose } from './templates';
