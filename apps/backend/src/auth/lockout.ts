import { redis } from '../redis/client';
import { authSettings } from './settings';

/**
 * Brute-force lockout (SPEC I6, hardening HIGH #2) — Redis counters with two
 * dimensions:
 *
 *  - PER ACCOUNT, keyed on the STABLE `uid:<id>` — the identifier is resolved
 *    to a user FIRST, so `bob` / `bob@x.com` / `Bob` all draw from ONE attempt
 *    budget (the original review's lockout-bypass fix).
 *  - PER CLIENT IP (the socket peer — unspoofable while TRUST_PROXY=false),
 *    a coarse flood guard across accounts.
 *
 * Counters live only in Redis with a TTL (ephemeral, GDPR-lean); once a
 * counter crosses its limit an explicit lock key is set for `lockSec`. A lock
 * blocks login EVEN WITH THE CORRECT PASSWORD until it expires.
 */
const PREFIX = 'gk:auth';

const failKey = (kind: 'uid' | 'ip', id: string): string => `${PREFIX}:fail:${kind}:${id}`;
const lockKey = (kind: 'uid' | 'ip', id: string): string => `${PREFIX}:lock:${kind}:${id}`;

export async function isLocked(kind: 'uid' | 'ip', id: string): Promise<boolean> {
  return (await redis.exists(lockKey(kind, id))) === 1;
}

/** Record a failed attempt; trips the lock when the windowed count crosses max. */
export async function registerFailure(kind: 'uid' | 'ip', id: string): Promise<void> {
  const s = await authSettings();
  const max = kind === 'uid' ? s.userMaxAttempts : s.ipMaxAttempts;
  const key = failKey(kind, id);
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, s.windowSec);
  if (count >= max) {
    await redis.set(lockKey(kind, id), '1', 'EX', s.lockSec);
  }
}

/** Successful login clears the ACCOUNT counter (never the IP flood counter). */
export async function clearFailures(uid: string): Promise<void> {
  await redis.del(failKey('uid', uid), lockKey('uid', uid));
}
