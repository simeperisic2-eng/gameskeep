import { describe, it, expect } from 'vitest';
import { HOMEPAGE_SECTIONS } from '@gameskeep/shared/constants';
import {
  cappedCredibleMass,
  coerceRules,
  countedCredibility,
  composeSection,
  matchesRules,
  playersDelta,
  ruleDimensionsFor,
  trendingDelta,
  trendingScore,
} from '../src/homepage/rules';
import { HomepageConfigError, validateSectionPatch } from '../src/homepage/sections';
import { expandToDaily } from '../src/steam/demo-history';

// Hermetic (no DB, no network): the Phase P S2 rules. The DB + SSR behaviour
// (and the DB-level rejection) is proven end-to-end by scripts/p-check.mjs (S2).

describe('Δ rules', () => {
  it('Trending: an empty previous window reads "New", never "—" or a made-up %', () => {
    expect(trendingDelta(5, 0)).toEqual({ kind: 'new' });
    expect(trendingDelta(0, 0)).toEqual({ kind: 'none' });
    expect(trendingDelta(15, 10)).toEqual({ kind: 'pct', value: 50 });
    expect(trendingDelta(0, 4)).toEqual({ kind: 'pct', value: -100 });
    expect(trendingDelta(Number.NaN, 3)).toEqual({ kind: 'pct', value: -100 });
  });
  it('By players: too few samples in either window → "—", never 0%', () => {
    expect(playersDelta([10, 11], [9, 9, 9], 3)).toEqual({ kind: 'none' });
    expect(playersDelta([10, 10, 10], [9, 9], 3)).toEqual({ kind: 'none' });
    expect(playersDelta([12, 12, 12], [10, 10, 10], 3)).toEqual({ kind: 'pct', value: 20 });
    expect(playersDelta([5, 5, 5], [0, 0, 0], 3)).toEqual({ kind: 'none' }); // zero baseline
    expect(playersDelta([5, Number.NaN, -1, 5, 5], [4, 4, 4], 3)).toEqual({
      kind: 'pct',
      value: 25,
    });
  });
});

describe('Trending weighting (credibility, capped per account)', () => {
  it('a ring of fresh, unverified accounts adds ≈ 0', () => {
    const ring = Array.from({ length: 50 }, () => ({ credibility: 0, count: 20 }));
    expect(cappedCredibleMass(ring, 1)).toBe(0);
  });
  it('one prolific account adds at most cap × its credibility', () => {
    expect(cappedCredibleMass([{ credibility: 0.8, count: 40 }], 1)).toBe(0.8);
    expect(cappedCredibleMass([{ credibility: 0.8, count: 40 }], 3)).toBe(2.4);
  });
  it('credibility is clamped to 0..1 and junk is ignored', () => {
    expect(
      cappedCredibleMass(
        [
          { credibility: 7, count: 1 },
          { credibility: Number.NaN, count: 9 },
        ],
        1,
      ),
    ).toBe(1);
    expect(cappedCredibleMass([{ credibility: 1, count: -5 }], 1)).toBe(0);
  });
  it('engagement amplifies coverage, never replaces it (a quiet story gains nothing)', () => {
    const w = { articles: 1, sources: 2, comments: 0.5, follows: 0.5 };
    expect(trendingScore({ articles: 0, sources: 0, comments: 40, follows: 40 }, w)).toBe(0);
    // coverage 3 (1 article + 1 outlet); engagement 20 → capped at 1 × coverage
    expect(trendingScore({ articles: 1, sources: 1, comments: 20, follows: 20 }, w, 1)).toBe(6);
    expect(trendingScore({ articles: 1, sources: 1, comments: 20, follows: 20 }, w, 0)).toBe(3);
  });
  it('accounts below the credibility floor add nothing (a verified email alone = 0.45)', () => {
    expect(countedCredibility(0.45, 0.5)).toBe(0);
    expect(countedCredibility(0.65, 0.5)).toBe(0.65);
    expect(countedCredibility(Number.NaN, 0)).toBe(0);
    expect(countedCredibility(3, 0.5)).toBe(1);
  });
  it('score = the weighted sum of the window inputs (negatives ignored)', () => {
    const w = { articles: 1, sources: 2, comments: 0.5, follows: 0.5 };
    expect(trendingScore({ articles: 3, sources: 2, comments: 1, follows: 2 }, w)).toBe(8.5);
    expect(trendingScore({ articles: -3, sources: 0, comments: 0, follows: 0 }, w)).toBe(0);
  });
});

describe('feed rules', () => {
  const rules = coerceRules({
    include: { genres: ['RPG', ' rpg ', 'Action'], bogus: ['x'] },
    exclude: { sources: ['Kotaku'] },
  });
  it('coerces stored JSON (lower-cased, deduped, unknown dims dropped)', () => {
    expect(rules).toEqual({
      include: { genres: ['rpg', 'action'] },
      exclude: { sources: ['kotaku'] },
    });
    expect(coerceRules(null)).toEqual({ include: {}, exclude: {} });
  });
  it('include intersects, exclude never matches', () => {
    expect(matchesRules({ genres: ['RPG'], sources: ['ign'] }, rules)).toBe(true);
    expect(matchesRules({ genres: ['Puzzle'] }, rules)).toBe(false);
    expect(matchesRules({ genres: ['rpg'], sources: ['kotaku'] }, rules)).toBe(false);
  });
  it('dimensions follow the item type', () => {
    expect(ruleDimensionsFor('topic')).toEqual(['categories', 'tags', 'genres', 'sources']);
    expect(ruleDimensionsFor('game')).toEqual(['tags', 'genres']);
    expect(ruleDimensionsFor('none')).toEqual([]);
  });
});

describe('composeSection (pins + auto + the one Promoted item)', () => {
  const auto = ['a', 'b', 'c', 'd', 'e'];
  it('pins hold their explicit position; auto fills the rest', () => {
    const out = composeSection({
      mode: 'pins_auto',
      itemCount: 4,
      pins: [{ position: 3, ref: 'p' }],
      auto,
    });
    expect(out.map((o) => o.ref)).toEqual(['a', 'b', 'p', 'c']);
    expect(out[2]).toEqual({ ref: 'p', pinned: true, promoted: false });
  });
  it('a pinned item keeps its position whatever the auto order does', () => {
    const pins = [{ position: 2, ref: 'p' }];
    const one = composeSection({ mode: 'pins_auto', itemCount: 4, pins, auto });
    const two = composeSection({
      mode: 'pins_auto',
      itemCount: 4,
      pins,
      auto: [...auto].reverse(),
    });
    expect(one.findIndex((o) => o.ref === 'p')).toBe(1);
    expect(two.findIndex((o) => o.ref === 'p')).toBe(1);
  });
  it('manual = pins only; auto = rule only', () => {
    const pins = [
      { position: 5, ref: 'p' },
      { position: 1, ref: 'q' },
    ];
    expect(composeSection({ mode: 'manual', itemCount: 6, pins, auto }).map((o) => o.ref)).toEqual([
      'q',
      'p',
    ]);
    expect(composeSection({ mode: 'auto', itemCount: 2, pins, auto }).map((o) => o.ref)).toEqual([
      'a',
      'b',
    ]);
  });
  it('the Promoted item takes its position (moved if already listed) and is the only paid entry', () => {
    const out = composeSection({
      mode: 'pins_auto',
      itemCount: 3,
      pins: [],
      auto,
      promoted: { position: 2, ref: 'd' },
    });
    expect(out.map((o) => o.ref)).toEqual(['a', 'd', 'b']);
    expect(out.filter((o) => o.promoted).map((o) => o.ref)).toEqual(['d']);
  });
  it('junk positions are ignored; the count is clamped', () => {
    const out = composeSection({
      mode: 'pins_auto',
      itemCount: 999,
      pins: [
        { position: 0, ref: 'x' },
        { position: 1.5, ref: 'y' },
      ],
      auto,
    });
    expect(out.map((o) => o.ref)).toEqual(auto);
  });
});

describe('validateSectionPatch (per kind)', () => {
  const sec = (key: keyof typeof HOMEPAGE_SECTIONS) => ({
    key,
    kind: HOMEPAGE_SECTIONS[key].kind,
    items: HOMEPAGE_SECTIONS[key].items,
    delta: HOMEPAGE_SECTIONS[key].delta,
    itemCount: 6,
  });
  const rejects = (fn: () => unknown): string => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(HomepageConfigError);
      return (e as Error).message;
    }
    throw new Error('expected a rejection');
  };
  it('a data section can never get a Promoted position', () => {
    for (const key of [
      'trending',
      'by_players',
      'top_rated',
      'our_picks',
      'latest',
      'focus',
    ] as const) {
      expect(rejects(() => validateSectionPatch(sec(key), { promotedPosition: 1 }))).toMatch(
        /never shown/,
      );
    }
    expect(validateSectionPatch(sec('featured'), { promotedPosition: 2 })).toEqual({
      promotedPosition: 2,
    });
  });
  it('Our picks is manual only; Δ windows only where a Δ shows', () => {
    expect(rejects(() => validateSectionPatch(sec('our_picks'), { mode: 'auto' }))).toMatch(
      /manual only/,
    );
    expect(rejects(() => validateSectionPatch(sec('top_rated'), { deltaWindowHours: 24 }))).toMatch(
      /no Δ/,
    );
    expect(validateSectionPatch(sec('trending'), { deltaWindowHours: 48 })).toEqual({
      deltaWindowHours: 48,
    });
  });
  it('rules only on the dimensions a section supports', () => {
    expect(
      rejects(() =>
        validateSectionPatch(sec('top_rated'), { rules: { include: { sources: ['ign'] } } }),
      ),
    ).toMatch(/not sources/);
    expect(
      validateSectionPatch(sec('trending'), { rules: { include: { sources: ['IGN'] } } }),
    ).toEqual({
      rules: { include: { sources: ['ign'] }, exclude: {} },
    });
  });
});

describe('expandToDaily (demo player history)', () => {
  const day = 86_400_000;
  const weekly = [
    { at: 0, current: 7000, peak: null },
    { at: 7 * day, current: 14000, peak: null },
    { at: 14 * day, current: 7000, peak: 20000 },
  ];
  it('one sample per day, ends exact with the recorded peak, wobble bounded', () => {
    const daily = expandToDaily(weekly, 'g1');
    expect(daily).toHaveLength(15);
    expect(daily[0]!.current).toBe(7000);
    expect(daily.at(-1)).toEqual({ at: 14 * day, current: 7000, peak: 20000 });
    for (let i = 1; i < daily.length; i += 1) expect(daily[i]!.at - daily[i - 1]!.at).toBe(day);
    expect(daily[7]!.current).toBe(14000); // the weekly anchor stays exact
    for (const d of daily)
      expect(d.current).toBeLessThanOrEqual(Math.round(14000 * 1.1 * 1.04 * 1.05));
    // different games drift differently
    expect(expandToDaily(weekly, 'g2').map((d) => d.current)).not.toEqual(
      daily.map((d) => d.current),
    );
  });
  it('deterministic per key; junk dropped; < 2 points passes through', () => {
    expect(expandToDaily(weekly, 'g1')).toEqual(expandToDaily(weekly, 'g1'));
    expect(
      expandToDaily([{ at: 0, current: Number.NaN, peak: null }, ...weekly.slice(0, 1)], 'x'),
    ).toHaveLength(1);
  });
});
