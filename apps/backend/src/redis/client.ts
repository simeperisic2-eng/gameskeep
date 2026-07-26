import { Redis } from 'ioredis';
import { env } from '../config/env';

/**
 * Shared application Redis client (used for the cache seam and health checks).
 *
 * `lazyConnect: true` means importing this module does NOT open a socket —
 * it connects on first command. That keeps unit tests hermetic. BullMQ
 * queues/workers create their own connections (see queue/connection.ts).
 */
export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
  connectTimeout: 5000,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});

redis.on('error', (err) => {
  // ioredis emits on every reconnect attempt; log quietly, never crash.
  console.error('[redis] connection error:', err.message);
});
