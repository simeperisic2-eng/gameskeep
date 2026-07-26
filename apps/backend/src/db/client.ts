import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { env } from '../config/env';
import * as schema from './schema';

const { Pool } = pg;

/**
 * Shared Postgres connection pool. node-postgres connects lazily (per query),
 * so importing this module performs no network I/O — safe for tests.
 */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  // Fail fast with a clear error instead of hanging forever on a bad host.
  connectionTimeoutMillis: 5000,
});

// An idle client erroring shouldn't take down the process — log and continue.
pool.on('error', (err) => {
  console.error('[db] unexpected idle client error:', err.message);
});

/** Drizzle ORM instance. The schema is empty until I1. */
export const db = drizzle(pool, { schema });
