import { randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../db/client';
import { userTokens } from '../db/schema';
import { emailSettings } from '../email/settings';
import { hashToken } from './session';

/**
 * Single-use email tokens (SPEC I6, Slice 2) — verify-email and password-reset.
 *
 * Discipline (all enforced here, none optional):
 *  - HASHED AT REST: only SHA-256(token) is stored (reusing the session helper);
 *    the raw 256-bit token exists solely inside the emailed link.
 *  - TTL'd: verify 24h / reset 1h (admin-tunable via `email` settings).
 *  - ONE ACTIVE per (user, purpose): issuing deletes any prior tokens for that
 *    pair, so an old link can't linger after a new one is sent.
 *  - SINGLE-USE + RACE-SAFE: consume is a conditional `UPDATE … WHERE
 *    consumed_at IS NULL AND expires_at > now() RETURNING`, atomic at the row —
 *    two concurrent redemptions can never both succeed.
 */
export type TokenPurpose = 'verify_email' | 'password_reset';

/** Issue a fresh token for (user, purpose); returns the RAW token exactly once. */
export async function issueToken(userId: string, purpose: TokenPurpose): Promise<string> {
  const raw = randomBytes(32).toString('hex'); // 256-bit
  const s = await emailSettings();
  const ttlSec = purpose === 'password_reset' ? s.resetTtlSec : s.verifyTtlSec;
  const expiresAt = new Date(Date.now() + ttlSec * 1000);

  await db.transaction(async (tx) => {
    // One active per (user, purpose): clear prior tokens first.
    await tx
      .delete(userTokens)
      .where(and(eq(userTokens.userId, userId), eq(userTokens.purpose, purpose)));
    await tx.insert(userTokens).values({
      userId,
      purpose,
      tokenHash: hashToken(raw),
      expiresAt,
    });
  });

  return raw;
}

/**
 * Redeem a token: atomically mark it consumed IFF it is unconsumed and unexpired
 * and matches the purpose. Returns the owning userId, or null if the token is
 * unknown / wrong-purpose / expired / already used. The conditional UPDATE is
 * the single-use race guard — a replay or a concurrent second attempt matches
 * zero rows.
 */
export async function consumeToken(
  rawToken: string,
  purpose: TokenPurpose,
): Promise<{ userId: string } | null> {
  if (!/^[a-f0-9]{64}$/.test(rawToken)) return null; // shape gate, no DB hit
  const rows = await db
    .update(userTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(userTokens.tokenHash, hashToken(rawToken)),
        eq(userTokens.purpose, purpose),
        isNull(userTokens.consumedAt),
        gt(userTokens.expiresAt, new Date()),
      ),
    )
    .returning({ userId: userTokens.userId });
  return rows[0] ? { userId: rows[0].userId } : null;
}
