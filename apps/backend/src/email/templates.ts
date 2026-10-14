/**
 * Email templates (SPEC I6, Slice 2) — PURE builders (no DB, no env read) so
 * they are hermetically testable and the link base is explicit. The raw token
 * appears ONLY here, inside the emailed link; it is never returned by any API
 * or rendered into served HTML. Plain-text bodies (no HTML/UGC → no injection
 * surface). The `EmailSender` seam turns these into `email_outbox` rows.
 */
export type EmailPurpose = 'verify_email' | 'password_reset' | 'account_exists' | 'newsletter';

export interface EmailMessage {
  toEmail: string;
  subject: string;
  bodyText: string;
  purpose: EmailPurpose;
}

/**
 * The public identity an email is sent under (Phase P S3b — the copy registry's
 * brand name + display domain; a rename is a settings change). Defaults keep the
 * pure builders callable without it.
 */
export interface EmailBrand {
  name: string;
  domain: string;
}
export const DEFAULT_EMAIL_BRAND: EmailBrand = { name: 'GamesKeep', domain: 'gameskeep.com' };

/** Trim a trailing slash so `${base}/path` never doubles up. */
function origin(base: string): string {
  return base.replace(/\/+$/, '');
}

export function verificationEmail(
  toEmail: string,
  rawToken: string,
  siteUrl: string,
  brand: EmailBrand = DEFAULT_EMAIL_BRAND,
): EmailMessage {
  const link = `${origin(siteUrl)}/verify-email?token=${rawToken}`;
  return {
    toEmail,
    purpose: 'verify_email',
    subject: `Confirm your ${brand.name} email`,
    bodyText: [
      `Welcome to ${brand.name}.`,
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
  brand: EmailBrand = DEFAULT_EMAIL_BRAND,
): EmailMessage {
  const link = `${origin(siteUrl)}/reset-password?token=${rawToken}`;
  return {
    toEmail,
    purpose: 'password_reset',
    subject: `Reset your ${brand.name} password`,
    bodyText: [
      `We received a request to reset your ${brand.name} password.`,
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
 * A newsletter campaign, sent to ONE consented subscriber (SPEC I8, Slice 3).
 * The body is staff-authored plain text (or a digest assembled from existing
 * summaries) — sent as text/plain, so there is no HTML/UGC injection surface.
 * Every marketing email MUST carry a working, login-free unsubscribe link
 * (GDPR / CAN-SPAM) built from the recipient's own capability token.
 */
export function newsletterEmail(
  toEmail: string,
  subject: string,
  body: string,
  unsubscribeToken: string,
  siteUrl: string,
  brand: EmailBrand = DEFAULT_EMAIL_BRAND,
): EmailMessage {
  const unsubscribe = `${origin(siteUrl)}/unsubscribe?token=${unsubscribeToken}`;
  return {
    toEmail,
    purpose: 'newsletter',
    // SECURITY (I8 review F5): the subject is the only staff-authored, variable
    // header. Collapse any CR/LF so it can never inject additional headers when
    // the seam is swapped to a real SMTP sender (harmless with the Mock/outbox
    // sender, which writes it to a DB column — fixed at the source regardless).
    subject: subject.replace(/[\r\n]+/g, ' ').trim(),
    bodyText: [
      body.trim(),
      '',
      '—',
      `You are receiving this because you subscribed to ${brand.name} updates (${brand.domain}).`,
      `Unsubscribe at any time: ${unsubscribe}`,
    ].join('\n'),
  };
}

/**
 * Enumeration-safety (SPEC I6): when someone tries to register an email that
 * is ALREADY registered, the requester gets the same generic 202 — and THIS
 * notice goes to the real address owner instead, never confirming existence to
 * the requester. Carries NO token (the owner requests their own reset).
 */
export function accountExistsEmail(
  toEmail: string,
  siteUrl: string,
  brand: EmailBrand = DEFAULT_EMAIL_BRAND,
): EmailMessage {
  const login = `${origin(siteUrl)}/login`;
  const reset = `${origin(siteUrl)}/reset-password`;
  return {
    toEmail,
    purpose: 'account_exists',
    subject: `Someone tried to register with your ${brand.name} email`,
    bodyText: [
      `Someone just tried to create a ${brand.name} account using this email address,`,
      'which already has an account.',
      '',
      `If this was you, simply sign in: ${login}`,
      `Forgot your password? Reset it here: ${reset}`,
      '',
      'If it was not you, no action is needed — no account was created or changed.',
    ].join('\n'),
  };
}
