import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db } from './client';

/**
 * Apply pending Drizzle migrations programmatically (drizzle-orm, not the dev
 * CLI) so the demo boots the schema with one command and production has no
 * separate migrate step. Run once by the API process on startup — NOT by the
 * worker, so there is a single migrator and no race.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, '../../drizzle');

export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder });
}
