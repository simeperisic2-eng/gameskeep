import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string compare for secrets (I6 hardening, LOW). Hash-first so
 * unequal lengths never short-circuit (`timingSafeEqual` throws on length
 * mismatch — hashing normalizes both sides to 32 bytes and removes the length
 * side-channel entirely).
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}
