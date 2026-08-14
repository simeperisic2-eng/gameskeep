import { env } from '../config/env';
import { getEmailSender } from './index';
import { accountExistsEmail, passwordResetEmail, verificationEmail } from './templates';

/**
 * High-level send helpers (SPEC I6, Slice 2). Each builds a message from the
 * pure template + the configured PUBLIC_SITE_URL and hands it to the active
 * sender (Mock → outbox in demo). Dispatch failures are logged and swallowed:
 * a mailbox hiccup must never change an enumeration-safe response or its
 * timing. Throttling + token issuance are the caller's job (the route).
 */
async function dispatch(fn: () => Promise<void>, label: string): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[email] ${label} send failed:`, err instanceof Error ? err.message : err);
  }
}

export async function sendVerificationEmail(
  toEmail: string,
  rawToken: string,
  relatedUserId?: string,
): Promise<void> {
  const msg = verificationEmail(toEmail, rawToken, env.PUBLIC_SITE_URL);
  await dispatch(() => getEmailSender().send(msg, { relatedUserId }), 'verification');
}

export async function sendPasswordResetEmail(
  toEmail: string,
  rawToken: string,
  relatedUserId?: string,
): Promise<void> {
  const msg = passwordResetEmail(toEmail, rawToken, env.PUBLIC_SITE_URL);
  await dispatch(() => getEmailSender().send(msg, { relatedUserId }), 'password-reset');
}

export async function sendAccountExistsNotice(
  toEmail: string,
  relatedUserId?: string,
): Promise<void> {
  const msg = accountExistsEmail(toEmail, env.PUBLIC_SITE_URL);
  await dispatch(() => getEmailSender().send(msg, { relatedUserId }), 'account-exists');
}
