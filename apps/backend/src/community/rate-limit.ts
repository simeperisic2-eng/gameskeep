import { redis } from '../redis/client';
import { communitySettings } from './settings';

/**
 * Per-user community write rate limit (SPEC I6, Slice 4) — the authenticated
 * counterpart to the anonymous `@fastify/rate-limit` (which explicitly does NOT
 * cover per-account write abuse). Same Redis-counter shape as the auth lockout
 * and the email throttle: INCR a windowed key, EXPIRE on first hit, reject once
 * the count crosses the `app_settings.community` cap.
 *
 * Fails OPEN on a Redis error — a cache blip must never block a legitimate
 * verified user from rating or commenting. Keyed on the stable user id (never
 * an IP), so it survives NAT and can't be dodged by rotating addresses.
 */
const PREFIX = 'gk:community:write';

/** Returns true if the write is allowed (and counts it); false if over the cap. */
export async function allowWrite(userId: string): Promise<boolean> {
  try {
    const s = await communitySettings();
    const key = `${PREFIX}:user:${userId}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, s.writeWindowSec);
    return count <= s.writesPerUser;
  } catch {
    return true; // fail open — never block a real user on a cache blip
  }
}
