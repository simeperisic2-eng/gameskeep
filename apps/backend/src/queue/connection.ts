import type { ConnectionOptions } from 'bullmq';
import { env } from '../config/env';

/**
 * BullMQ connection options derived from REDIS_URL.
 *
 * We pass plain options (not an ioredis instance) so BullMQ creates and owns
 * its connections with its own bundled ioredis — this avoids any dual-package
 * type/instanceof mismatch between our app's ioredis and BullMQ's. BullMQ
 * requires `maxRetriesPerRequest: null` on its connections.
 */
export function queueConnection(): ConnectionOptions {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
  };
}
