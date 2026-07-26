import { describe, it, expect } from 'vitest';
import { gameCreate } from '@gameskeep/shared/validation';
import { sanitizeNormalizedGame } from '../src/catalog/normalize';
import { MockGameProvider, isUpcomingGame } from '../src/data-source/games/mock-provider';
import { MOCK_GAMES } from '../src/data-source/games/mock-data';
import { describeGameProvider, getGameDataProvider } from '../src/data-source/games';
import { liveGameProvider } from '../src/data-source/games/live-provider';

// All hermetic — no DB. The live import/resolve/upsert path runs against the
// booted stack via scripts/i2-check.mjs.

describe('sanitizeNormalizedGame (defensive normalization)', () => {
  it('returns null when there is no usable name', () => {
    expect(sanitizeNormalizedGame(null)).toBeNull();
    expect(sanitizeNormalizedGame({})).toBeNull();
    expect(sanitizeNormalizedGame({ name: '   ' })).toBeNull();
    expect(sanitizeNormalizedGame({ name: 42 } as never)).toBeNull();
  });

  it('never throws on partial / oddly-typed input', () => {
    const weird = {
      name: 'Weird Game',
      genres: 'not-an-array',
      platforms: [1, 2, { x: 1 }, 'PC', 'PC'],
      releaseDate: '2020-13-99',
      coverUrl: 'javascript:alert(1)',
      screenshots: ['not a url', 'https://ok.example/a.png'],
      steamAppId: -5,
      steamCompletionRate: 9000,
      status: 'totally-made-up',
      socialLinks: { x: 'https://x.com/g', bad: 'ftp://nope' },
    } as never;
    const clean = sanitizeNormalizedGame(weird);
    expect(clean).not.toBeNull();
    expect(clean!.name).toBe('Weird Game');
    expect(clean!.genres).toEqual(['not-an-array']); // string coerced to single-item array
    expect(clean!.platforms).toEqual(['PC']); // numbers/objects dropped, dupes removed
    expect(clean!.releaseDate).toBeUndefined(); // impossible date rejected
    expect(clean!.coverUrl).toBeUndefined(); // non-http URL rejected
    expect(clean!.screenshots).toEqual(['https://ok.example/a.png']);
    expect(clean!.steamAppId).toBeUndefined(); // out of range → dropped
    expect(clean!.steamCompletionRate).toBe(100); // clamped into [0,100]
    expect(clean!.status).toBe('announced'); // unknown status → safe default
    expect(clean!.socialLinks).toEqual({ x: 'https://x.com/g' });
  });

  it('clamps overlong strings to schema limits', () => {
    const clean = sanitizeNormalizedGame({ name: 'A'.repeat(1000), developer: 'D'.repeat(1000) });
    expect(clean!.name.length).toBe(300);
    expect(clean!.developer!.length).toBe(200);
  });

  it('produces output that satisfies the gameCreate validator', () => {
    const clean = sanitizeNormalizedGame({
      name: 'Some Game',
      status: 'released',
      genres: ['RPG'],
      steamAppId: 12345,
      releaseDate: '2021-05-10',
    });
    expect(gameCreate.safeParse(clean).success).toBe(true);
  });
});

describe('MockGameProvider', () => {
  const provider = new MockGameProvider();

  it('searches by name', async () => {
    const hits = await provider.search('elden');
    expect(hits.some((g) => g.name === 'Elden Ring')).toBe(true);
  });

  it('resolves by name case-insensitively and ignoring punctuation', async () => {
    expect((await provider.resolveByName('ELDEN RING'))?.name).toBe('Elden Ring');
    expect((await provider.resolveByName('baldurs gate 3'))?.slug).toBe('baldurs-gate-3');
  });

  it('returns null when nothing matches', async () => {
    expect(await provider.resolveByName('zzz-not-a-real-game-zzz')).toBeNull();
  });

  it('listSeed excludes seed:false entries that resolveByName can still find', async () => {
    const seed = await provider.listSeed();
    const seedSlugs = new Set(seed.map((g) => g.slug));
    expect(seedSlugs.has('the-witcher-iv')).toBe(false); // not bulk-seeded
    expect((await provider.resolveByName('The Witcher IV'))?.slug).toBe('the-witcher-iv'); // but resolvable
  });

  it('listUpcoming returns only upcoming games (incl. GTA VI)', async () => {
    const upcoming = await provider.listUpcoming();
    expect(upcoming.length).toBeGreaterThan(0);
    expect(upcoming.every((g) => isUpcomingGame(g))).toBe(true);
    expect(upcoming.some((g) => g.name === 'Grand Theft Auto VI')).toBe(true);
  });
});

describe('mock dataset sanity', () => {
  it('is a broad catalog with unique slugs', () => {
    expect(MOCK_GAMES.length).toBeGreaterThanOrEqual(150);
    const slugs = MOCK_GAMES.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('every entry has a name and a valid slug', () => {
    for (const g of MOCK_GAMES) {
      expect(g.name.trim().length).toBeGreaterThan(0);
      expect(g.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it('covers a spread of statuses incl. upcoming and delisted', () => {
    const statuses = new Set(MOCK_GAMES.map((g) => g.status));
    expect(statuses.has('released')).toBe(true);
    expect(statuses.has('delisted')).toBe(true);
    expect(MOCK_GAMES.filter((g) => isUpcomingGame(g)).length).toBeGreaterThanOrEqual(5);
  });

  it('includes some resolvable-but-not-seeded entries (auto-resolve demo)', () => {
    expect(MOCK_GAMES.filter((g) => g.seed === false).length).toBeGreaterThanOrEqual(3);
  });

  it('keeps the I1 seed games (so the inline seed stays idempotent)', () => {
    const slugs = new Set(MOCK_GAMES.map((g) => g.slug));
    expect(slugs.has('cyberpunk-2077')).toBe(true);
    expect(slugs.has('baldurs-gate-3')).toBe(true);
  });
});

describe('provider seam (demo ↔ production switch)', () => {
  it('returns the Mock provider in demo mode', () => {
    expect(getGameDataProvider().name).toBe('mock');
    const status = describeGameProvider();
    expect(status.provider).toBe('mock');
    expect(status.live).toBe(false);
  });

  it('the Live provider refuses to call out without keys (no network in demo)', async () => {
    // listUpcoming hits IGDB first; with blank keys it must throw, never fetch.
    await expect(liveGameProvider.listUpcoming()).rejects.toThrow(/IGDB_CLIENT_ID/);
  });
});
