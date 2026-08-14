import { createHash } from 'node:crypto';
import { redis } from '../redis/client';
import { emailSettings } from './settings';

/**
 * Send throttle (SPEC I6, Slice 2) — caps outbound email in two dimensions so
 * neither a real inbox nor the outbox can be flooded (e.g. by repeatedly
 * "registering" someone else's address to spam them the account-exists notice,
 * or hammering resend): per RECIPIENT email and per CLIENT IP. Redis counters
 * with a TTL window (ephemeral, GDPR-lean); the email is hashed so raw
 * addresses never sit in a Redis key. Same counter shape as the auth lockout.
 *
 * The caller treats a `false` as "silently skip the send" and still returns
 * the SAME enumeration-safe response — a throttled requester cannot tell a
 * throttle from a successful send. Fails OPEN (allows) if Redis is unreachable
 * so a cache blip never blocks legitimate verification.
 */
const PREFIX = 'gk:email:send';

const emailKey = (emailLower: string): string =>
  `${PREFIX}:email:${createHash('sha256').update(emailLower).digest('hex').slice(0, 32)}`;
const ipKey = (ip: string): string => `${PREFIX}:ip:${ip}`;

export async function canSend(emailLower: string, ip: string | undefined | null): Promise<boolean> {
  try {
    const s = await emailSettings();
    const eKey = emailKey(emailLower);
    const iKey = ip ? ipKey(ip) : null;

    const eCount = Number((await redis.get(eKey)) ?? 0);
    const iCount = iKey ? Number((await redis.get(iKey)) ?? 0) : 0;
    if (eCount >= s.sendMaxPerEmail || iCount >= s.sendMaxPerIp) return false;

    const ne = await redis.incr(eKey);
    if (ne === 1) await redis.expire(eKey, s.sendWindowSec);
    if (iKey) {
      const ni = await redis.incr(iKey);
      if (ni === 1) await redis.expire(iKey, s.sendWindowSec);
    }
    return true;
  } catch {
    return true; // fail open — a Redis blip must not block real verification
  }
}
