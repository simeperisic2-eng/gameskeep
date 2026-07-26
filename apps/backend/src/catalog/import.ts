import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { games } from '../db/schema';
import { getGameDataProvider, type GameDataProvider } from '../data-source/games';
import { sanitizeNormalizedGame } from './normalize';
import { upsertGameFromNormalized } from './upsert';

/**
 * Catalog importer (SPEC I2 §2/§4). Pulls the provider's seed catalog (mock
 * dataset in demo; a gentle bounded IGDB pull in production), sanitizes every
 * record defensively, and upserts it idempotently. This is the engine the
 * background `catalog-import` job runs — never on the user request path
 * (CLAUDE.md: "nothing heavy on user request").
 */

/** Below this many games we treat the catalog as "empty" and (re)load it. */
export const CATALOG_POPULATED_THRESHOLD = 100;

export interface CatalogImportResult {
  provider: string;
  fetched: number;
  imported: number;
  skipped: number;
  invalid: number;
  totalGames: number;
}

async function countGames(): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(games);
  return row?.count ?? 0;
}

export interface ImportOptions {
  /** Skip the whole import if the catalog already looks populated (boot path). */
  skipIfPopulated?: boolean;
  /** Cap how many records to pull (mainly for the live path / tests). */
  limit?: number;
  provider?: GameDataProvider;
}

export async function importCatalog(opts: ImportOptions = {}): Promise<CatalogImportResult> {
  const provider = opts.provider ?? getGameDataProvider();

  if (opts.skipIfPopulated) {
    const current = await countGames();
    if (current >= CATALOG_POPULATED_THRESHOLD) {
      return {
        provider: provider.name,
        fetched: 0,
        imported: 0,
        skipped: current,
        invalid: 0,
        totalGames: current,
      };
    }
  }

  const records = await provider.listSeed({ limit: opts.limit });
  let imported = 0;
  let skipped = 0;
  let invalid = 0;

  for (const record of records) {
    const clean = sanitizeNormalizedGame(record);
    if (!clean) {
      invalid += 1;
      continue;
    }
    try {
      const result = await upsertGameFromNormalized(clean);
      if (result.created) imported += 1;
      else skipped += 1;
    } catch {
      // One malformed record must never abort the whole import (anti-bug rule).
      invalid += 1;
    }
  }

  return {
    provider: provider.name,
    fetched: records.length,
    imported,
    skipped,
    invalid,
    totalGames: await countGames(),
  };
}
