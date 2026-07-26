import type { GameDataProviderName } from '@gameskeep/shared/constants';
import type { GameDataProvider, NormalizedGame, ProviderListOptions } from './types';
import { MOCK_GAMES, type MockGameRecord } from './mock-data';

/**
 * MockProvider — the DEMO game-data source (SPEC I2 §1). It serves the bundled
 * local dataset and makes NO network calls whatsoever. The data is already in
 * the normalized shape, so "normalization" here is just a defensive copy; the
 * real per-source mapping lives in the LiveProvider.
 */

/** Loose match key: lowercase, alphanumeric-only (so "Baldur's Gate 3" == "baldurs gate 3"). */
function matchKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Strip mock-only fields so callers only ever see the NormalizedGame contract. */
function toNormalized(record: MockGameRecord): NormalizedGame {
  const { seed: _seed, ...game } = record;
  void _seed;
  return { ...game };
}

/**
 * Upcoming = explicitly pre-release status, OR a known future release date.
 * Status-based detection keeps it stable regardless of the wall clock; the date
 * rule additionally catches "released"-tagged rows whose date hasn't passed yet.
 */
export function isUpcomingGame(game: NormalizedGame, now: Date = new Date()): boolean {
  if (game.status === 'announced' || game.status === 'in_development') return true;
  if (game.releaseDate && /^\d{4}-\d{2}-\d{2}$/.test(game.releaseDate)) {
    const release = new Date(`${game.releaseDate}T00:00:00Z`);
    if (!Number.isNaN(release.getTime()) && release.getTime() > now.getTime()) return true;
  }
  return false;
}

export class MockGameProvider implements GameDataProvider {
  readonly name: GameDataProviderName = 'mock';

  private readonly all: MockGameRecord[];

  constructor(dataset: MockGameRecord[] = MOCK_GAMES) {
    this.all = dataset;
  }

  async search(query: string, opts: ProviderListOptions = {}): Promise<NormalizedGame[]> {
    const key = matchKey(query);
    if (!key) return [];
    const limit = opts.limit ?? 20;
    const scored = this.all
      .map((g) => {
        const name = matchKey(g.name);
        let score = 0;
        if (name === key) score = 3;
        else if (name.startsWith(key)) score = 2;
        else if (name.includes(key)) score = 1;
        return { g, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || a.g.name.localeCompare(b.g.name))
      .slice(0, limit);
    return scored.map((s) => toNormalized(s.g));
  }

  async getByExternalId(externalId: string): Promise<NormalizedGame | null> {
    const found = this.all.find((g) => g.externalId === externalId);
    return found ? toNormalized(found) : null;
  }

  async resolveByName(name: string): Promise<NormalizedGame | null> {
    const key = matchKey(name);
    if (!key) return null;
    // Exact match wins; otherwise fall back to the best search hit.
    const exact = this.all.find((g) => matchKey(g.name) === key);
    if (exact) return toNormalized(exact);
    const [best] = await this.search(name, { limit: 1 });
    return best ?? null;
  }

  async listUpcoming(opts: ProviderListOptions = {}): Promise<NormalizedGame[]> {
    const now = new Date();
    const upcoming = this.all.filter((g) => isUpcomingGame(g, now)).map(toNormalized);
    return typeof opts.limit === 'number' ? upcoming.slice(0, opts.limit) : upcoming;
  }

  async listSeed(opts: ProviderListOptions = {}): Promise<NormalizedGame[]> {
    // `seed: false` entries are resolvable on demand but not bulk-loaded.
    const seedable = this.all.filter((g) => g.seed !== false).map(toNormalized);
    return typeof opts.limit === 'number' ? seedable.slice(0, opts.limit) : seedable;
  }
}

export const mockGameProvider = new MockGameProvider();
