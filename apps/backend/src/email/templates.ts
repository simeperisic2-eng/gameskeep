/**
 * Email templates (SPEC I6, Slice 2) — PURE builders (no DB, no env read) so
 * they are hermetically testable and the link base is explicit. The raw token
 * appears ONLY here, inside the emailed link; it is never returned by any API
 * or rendered into served HTML. Plain-text bodies (no HTML/UGC → no injection
 * surface). The `EmailSender` seam turns these into `email_outbox` rows.
 */
export type EmailPurpose = 'verify_email' | 'password_reset' | 'account_exists';

export interface EmailMessage {
  toEmail: string;
  subject: string;
  bodyText: string;
  purpose: EmailPurpose;
}

/** Trim a trailing slash so `${base}/path` never doubles up. */
function origin(base: string): string {
  return base.replace(/\/+$/, '');
}

export function verificationEmail(
  toEmail: string,
  rawToken: string,
  siteUrl: string,
): EmailMessage {
  const link = `${origin(siteUrl)}/verify-email?token=${rawToken}`;
  return {
    toEmail,
    purpose: 'verify_email',
    subject: 'Confirm your GamesKeep email',
    bodyText: [
      'Welcome to GamesKeep.',
      '',
      'Confirm this email address to activate rating, voting and commenting:',
      link,
      '',
      'This link expires in 24 hours. If you did not create an account, ignore this message.',
    ].join('\n'),
  };
}

export function passwordResetEmail(
  toEmail: string,
  rawToken: string,
  siteUrl: string,
): EmailMessage {
  const link = `${origin(siteUrl)}/reset-password?token=${rawToken}`;
  return {
    toEmail,
    purpose: 'password_reset',
    subject: 'Reset your GamesKeep password',
    bodyText: [
      'We received a request to reset your GamesKeep password.',
      '',
      'Set a new password here:',
      link,
      '',
      'This link expires in 1 hour and can be used once. If you did not request this,',
      'ignore this message — your password is unchanged.',
    ].join('\n'),
  };
}

/**
 * Enumeration-safety (SPEC I6): when someone tries to register an email that
 * is ALREADY registered, the requester gets the same generic 202 — and THIS
 * notice goes to the real address owner instead, never confirming existence to
 * the requester. Carries NO token (the owner requests their own reset).
 */
export function accountExistsEmail(toEmail: string, siteUrl: string): EmailMessage {
  const login = `${origin(siteUrl)}/login`;
  const reset = `${origin(siteUrl)}/reset-password`;
  return {
    toEmail,
    purpose: 'account_exists',
    subject: 'Someone tried to register with your GamesKeep email',
    bodyText: [
      'Someone just tried to create a GamesKeep account using this email address,',
      'which already has an account.',
      '',
      `If this was you, simply sign in: ${login}`,
      `Forgot your password? Reset it here: ${reset}`,
      '',
      'If it was not you, no action is needed — no account was created or changed.',
    ].join('\n'),
  };
}
