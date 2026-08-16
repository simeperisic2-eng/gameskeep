import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { and, eq, gt, ne } from 'drizzle-orm';
import { db } from '../db/client';
import { roles, sessions, userLevels, users } from '../db/schema';
import { constantTimeEqual } from '../lib/crypto';

/**
 * Server-side sessions (SPEC I6, locked decision 1 — sessions, not JWT).
 *
 * The raw token is 256 bits of CSPRNG output and exists ONLY in the signed
 * HttpOnly cookie; the DB stores its SHA-256. Lookup = hash the presented
 * token and match — a DB leak yields nothing replayable, and revocation is a
 * row delete (instant, no JWT-style wait-for-expiry).
 *
 * Expiry is SLIDING (activity extends `expiresAt` by the TTL) under a HARD
 * ABSOLUTE CAP (`absoluteExpiresAt` = createdAt + 90 days) that activity can
 * never push past.
 */
export const SESSION_COOKIE = 'gk_session';
export const CSRF_COOKIE = 'gk_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export const SLIDING_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days of inactivity
export const ABSOLUTE_CAP_MS = 90 * 24 * 60 * 60 * 1000; // hard cap (decision 1)
/** Only touch the sliding window when the last touch is older than this. */
const TOUCH_INTERVAL_MS = 15 * 60 * 1000;

/** SHA-256 hex of a raw session token — the only form that ever hits the DB. */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** New CSRF double-submit value (non-HttpOnly cookie + echoed header). */
export function newCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Double-submit CSRF check: the `x-csrf-token` header must be present AND equal
 * the readable `gk_csrf` cookie. An attacker's cross-site page can neither read
 * the cookie (to echo it) nor set the header on a form post, so a forged
 * request fails. Shared by the /auth scope and the staff-session admin path.
 */
export function csrfOk(req: FastifyRequest): boolean {
  const cookie = req.cookies[CSRF_COOKIE];
  const header = req.headers[CSRF_HEADER];
  const provided = Array.isArray(header) ? header[0] : header;
  if (!cookie || !provided) return false;
  // Constant-time (I6 review, INFO): consistent with the admin-token compare —
  // the length side-channel is removed by the hash-first helper.
  return constantTimeEqual(cookie, provided);
}

/**
 * Coarsen an IP for STORAGE (GDPR-lean, same rule for sessions + consents):
 * IPv4 keeps /24 (last octet zeroed), IPv6 keeps the first three hextets.
 */
export function coarsenIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0`;
  if (ip.includes(':')) {
    const groups = ip.split(':').filter((g) => g.length > 0);
    return `${groups.slice(0, 3).join(':')}::`;
  }
  return null; // unparseable — store nothing rather than something wrong
}

export interface SessionUser {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  isEmailVerified: boolean;
  reputation: number;
  status: string;
  createdAt: Date;
  role: { key: string; label: string; rank: number; isStaff: boolean };
  level: { key: string; label: string } | null;
}

export interface ValidSession {
  sessionId: string;
  user: SessionUser;
}

/** Create a session; returns the RAW token (for the cookie) exactly once. */
export async function createSession(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ rawToken: string; sessionId: string }> {
  const rawToken = randomBytes(32).toString('hex'); // 256-bit
  const now = Date.now();
  const absolute = new Date(now + ABSOLUTE_CAP_MS);
  const [row] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: hashToken(rawToken),
      ip: coarsenIp(meta.ip),
      userAgent: meta.userAgent?.slice(0, 400) ?? null,
      expiresAt: new Date(Math.min(now + SLIDING_TTL_MS, absolute.getTime())),
      absoluteExpiresAt: absolute,
    })
    .returning({ id: sessions.id });
  return { rawToken, sessionId: row!.id };
}

/**
 * Validate a presented raw token: hash → row → not expired (sliding AND
 * absolute) → user active. Touches the sliding window at most every 15 min.
 */
export async function validateSession(rawToken: string): Promise<ValidSession | null> {
  if (!/^[a-f0-9]{64}$/.test(rawToken)) return null; // shape gate, no DB hit
  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const [row] = await db
    .select({
      sessionId: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      absoluteExpiresAt: sessions.absoluteExpiresAt,
      user: {
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        isEmailVerified: users.isEmailVerified,
        reputation: users.reputation,
        status: users.status,
        createdAt: users.createdAt,
      },
      roleKey: roles.key,
      roleLabel: roles.label,
      roleRank: roles.rank,
      roleIsStaff: roles.isStaff,
      levelKey: userLevels.key,
      levelLabel: userLevels.label,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(roles, eq(roles.id, users.roleId))
    .leftJoin(userLevels, eq(userLevels.id, users.levelId))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);

  if (!row) return null;
  if (now > row.expiresAt || now > row.absoluteExpiresAt) {
    // Expired — clean up eagerly so dead rows don't accumulate.
    await db.delete(sessions).where(eq(sessions.id, row.sessionId));
    return null;
  }
  // Defense in depth: ban/suspend revokes sessions at action time (Slice 3),
  // but a non-active user is rejected here regardless.
  if (row.user.status !== 'active') return null;

  if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    const slid = Math.min(now.getTime() + SLIDING_TTL_MS, row.absoluteExpiresAt.getTime());
    await db
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt: new Date(slid) })
      .where(eq(sessions.id, row.sessionId));
  }

  return {
    sessionId: row.sessionId,
    user: {
      ...row.user,
      role: {
        key: row.roleKey,
        label: row.roleLabel,
        rank: row.roleRank,
        isStaff: row.roleIsStaff,
      },
      level: row.levelKey ? { key: row.levelKey, label: row.levelLabel ?? row.levelKey } : null,
    },
  };
}

/** Revoke one session (logout). */
export async function revokeSession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/**
 * Revoke every session of a user (logout-everywhere / ban / password change —
 * pass `exceptSessionId` to keep the current one on password change).
 */
export async function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<number> {
  const where = exceptSessionId
    ? and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId))
    : eq(sessions.userId, userId);
  const rows = await db.delete(sessions).where(where).returning({ id: sessions.id });
  return rows.length;
}

/** Count a user's live sessions (observability/verify). */
export async function countLiveSessions(userId: string): Promise<number> {
  const rows = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())));
  return rows.length;
}
