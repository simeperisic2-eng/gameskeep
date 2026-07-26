import { pool } from './client';
import { errorMessage } from '../lib/errors';

export interface DbHealth {
  ok: boolean;
  /** Whether the pgvector extension is installed (needed for clustering in I3). */
  vectorExtension: boolean;
  error?: string;
}

/**
 * Light connectivity probe: a `SELECT 1` plus a check that the pgvector
 * extension is present. Cheap enough for a readiness endpoint.
 */
export async function checkDb(): Promise<DbHealth> {
  let client;
  try {
    client = await pool.connect();
    await client.query('SELECT 1');
    const res = await client.query(
      "SELECT 1 AS present FROM pg_extension WHERE extname = 'vector'",
    );
    return { ok: true, vectorExtension: res.rowCount === 1 };
  } catch (err) {
    return { ok: false, vectorExtension: false, error: errorMessage(err) };
  } finally {
    client?.release();
  }
}
