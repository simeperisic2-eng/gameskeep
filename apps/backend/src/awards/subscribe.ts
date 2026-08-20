import { randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { newsletterSubscriptions, users } from '../db/schema';
import { coarsenIp } from '../auth/session';
import { recordConsent } from '../gdpr/service';

/**
 * Subscribe capture (SPEC I7, Slice 2; BLUEPRINT 2.8). Marketing consent is
 * SEPARATE from registration consent, so:
 *   - opt-in is EXPLICIT (the route rejects a subscribe without `consent:true`);
 *   - every capture stamps the marketing-consent VERSION + a COARSENED ip;
 *   - a REGISTERED subscriber ALSO gets a canonical `user_consents`
 *     kind='marketing' row (grant on subscribe, WITHDRAW on unsubscribe) — the
 *     same flow used everywhere else, never a parallel consent path;
 *   - an ANONYMOUS subscriber gets the identical treatment carried on the
 *     subscription row (versioned opt-in + coarsened ip + unsubscribe token).
 * Real sending is I8; here we only capture and honour unsubscribe.
 *
 * [[OWNER-TODO: upgrade to DOUBLE opt-in when real email sending lands (I8) —
 * subscribe should create a PENDING row (active=false) + email a hashed confirm
 * token; record the marketing consent only on CONFIRM; keep the unsubscribe token
 * hashed at rest. Single opt-in is an accepted demo simplification (no sends), but
 * do NOT enable real sends without double opt-in + edge rate-limit/captcha —
 * otherwise it's a list-bombing / subscribe-a-victim vector.]]
 */

// [[OWNER-TODO: set the real current marketing-consent version string (+ the
// consent-UI copy) before launch — ties into the existing consent-versions
// OWNER-TODO. This demo default is what every capture is stamped with.]]
export const MARKETING_CONSENT_VERSION = 'marketing-2026-01-demo';
export const MARKETING_CONSENT_TYPE = 'marketing';

export interface SubscribeInput {
  email: string;
  userId?: string | null;
  source?: string;
  /** Raw client ip — coarsened here before it is ever stored. */
  ip?: string | null;
}

/**
 * True iff `email` is the VERIFIED email of user `userId` (case-insensitive).
 *
 * SECURITY (I8 review F1 — HIGH): the subscribe route takes `email` from the
 * request BODY but the actor from the SESSION. Attaching the session user's id
 * to an arbitrary body email let a signed-in attacker repoint a victim's
 * subscription to the attacker's account — the consent gate then read the
 * ATTACKER's consent, so a withdrawn victim could be mailed. The signed-in link
 * is now bound to the caller's OWN verified email only; any other email is
 * treated as anonymous.
 */
export async function emailOwnedByVerifiedUser(userId: string, email: string): Promise<boolean> {
  const wanted = email.trim().toLowerCase();
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, userId),
        eq(sql`lower(${users.email})`, wanted),
        eq(users.isEmailVerified, true),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Explicit opt-in subscribe. Idempotent: re-subscribing reactivates and refreshes
 * the row (keeping its existing unsubscribe token + any known user link). Records
 * the marketing consent grant for a signed-in subscriber.
 */
export async function subscribe(input: SubscribeInput): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const ip = coarsenIp(input.ip);
  const source = input.source ?? 'awards';

  const [existing] = await db
    .select({ id: newsletterSubscriptions.id, userId: newsletterSubscriptions.userId })
    .from(newsletterSubscriptions)
    .where(eq(newsletterSubscriptions.email, email))
    .limit(1);

  if (existing) {
    await db
      .update(newsletterSubscriptions)
      .set({
        // WRITE-ONCE owner link (I8 review F1): keep an existing non-null link;
        // only adopt the incoming id when the row is currently anonymous. A
        // third party can therefore never repoint someone else's subscription to
        // their own account (which would swap whose consent the gate reads).
        userId: existing.userId ?? input.userId ?? null,
        source,
        consentVersion: MARKETING_CONSENT_VERSION,
        active: true,
        ip,
        unsubscribedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(newsletterSubscriptions.id, existing.id));
  } else {
    await db.insert(newsletterSubscriptions).values({
      email,
      userId: input.userId ?? null,
      source,
      consentVersion: MARKETING_CONSENT_VERSION,
      active: true,
      ip,
      unsubscribeToken: randomBytes(32).toString('hex'),
    });
  }

  if (input.userId) {
    await recordConsent(
      input.userId,
      MARKETING_CONSENT_TYPE,
      MARKETING_CONSENT_VERSION,
      true,
      input.ip,
    );
  }
}

/**
 * Login-free unsubscribe via the capability token. Idempotent + enumeration-safe:
 * returns false for an unknown token (the route replies generically either way).
 * Records the marketing consent WITHDRAWAL for a signed-in subscriber.
 */
export async function unsubscribe(token: string): Promise<boolean> {
  const [sub] = await db
    .select({
      id: newsletterSubscriptions.id,
      userId: newsletterSubscriptions.userId,
      ip: newsletterSubscriptions.ip,
    })
    .from(newsletterSubscriptions)
    .where(eq(newsletterSubscriptions.unsubscribeToken, token))
    .limit(1);
  if (!sub) return false;

  await db
    .update(newsletterSubscriptions)
    .set({ active: false, unsubscribedAt: new Date(), updatedAt: new Date() })
    .where(eq(newsletterSubscriptions.id, sub.id));

  if (sub.userId) {
    await recordConsent(
      sub.userId,
      MARKETING_CONSENT_TYPE,
      MARKETING_CONSENT_VERSION,
      false,
      sub.ip,
    );
  }
  return true;
}

/**
 * Suppress a user's newsletter subscription when they WITHDRAW marketing consent
 * through a path OTHER than the unsubscribe link (e.g. the account-panel consent
 * toggle → `POST /auth/consent`). Keeps the subscription's `active` flag in lock-
 * step with the consent ledger so segmentation can never target a withdrawn user
 * (SPEC I8, Slice 3 — GDPR gate). Idempotent; no-op if they have no subscription.
 */
export async function deactivateSubscriptionForUser(userId: string): Promise<void> {
  await db
    .update(newsletterSubscriptions)
    .set({ active: false, unsubscribedAt: new Date(), updatedAt: new Date() })
    .where(
      sql`${newsletterSubscriptions.userId} = ${userId} and ${newsletterSubscriptions.active} = true`,
    );
}

/** Count of active subscribers (optionally for one source) — analytics/read only. */
export async function activeSubscriberCount(source?: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<string>`count(*)` })
    .from(newsletterSubscriptions)
    .where(
      source
        ? sql`${newsletterSubscriptions.active} = true and ${newsletterSubscriptions.source} = ${source}`
        : eq(newsletterSubscriptions.active, true),
    );
  return Number(row?.n ?? 0);
}
