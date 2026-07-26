import { redis } from './client';

/**
 * Minimal JSON cache helpers — the caching seam required "from the start"
 * (CLAUDE.md: speed by design). Heavy results computed by background jobs in
 * later phases are stored through here so user requests only ever read.
 *
 * Unused by I0 endpoints on purpose: the seam exists; callers arrive later.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const raw = await redis.get(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Corrupt/legacy value — treat as a miss rather than throwing.
    return null;
  }
}

export async function cacheSet<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
  const raw = JSON.stringify(value);
  if (ttlSeconds && ttlSeconds > 0) {
    await redis.set(key, raw, 'EX', ttlSeconds);
  } else {
    await redis.set(key, raw);
  }
}

/** Read-through cache: return the cached value or compute, store, and return it. */
export async function cacheGetOrSet<T>(
  key: string,
  ttlSeconds: number,
  producer: () => Promise<T>,
): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return hit;
  const value = await producer();
  await cacheSet(key, value, ttlSeconds);
  return value;
}
