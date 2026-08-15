import { describe, expect, it } from 'vitest';
import { levelKeyFor, levelProgress } from '../src/reputation/engine';
import { REPUTATION_DEFAULTS } from '../src/reputation/settings';

/**
 * Hermetic I6 Slice-5 tests — the pure level math (thresholds + progress). The
 * live proofs (a self-farm ring failing to raise reputation, credible reactions
 * levelling a user up, auto-badges, and the leak-proof profile that hides the
 * number/thresholds) run in scripts/i6-check.mjs.
 */
const T = REPUTATION_DEFAULTS.levelThresholds; // { contributor:15, trusted:60, veteran:200, legend:500 }

describe('reputation: level thresholds (highest satisfied wins)', () => {
  it('maps a reputation to the correct level key', () => {
    expect(levelKeyFor(0, T)).toBe('newcomer');
    expect(levelKeyFor(14, T)).toBe('newcomer');
    expect(levelKeyFor(15, T)).toBe('contributor');
    expect(levelKeyFor(59, T)).toBe('contributor');
    expect(levelKeyFor(60, T)).toBe('trusted');
    expect(levelKeyFor(200, T)).toBe('veteran');
    expect(levelKeyFor(500, T)).toBe('legend');
    expect(levelKeyFor(99_999, T)).toBe('legend');
  });
});

describe('reputation: level progress (0→1 toward next; leaks no absolute threshold)', () => {
  it('is a within-band fraction, resets to 0 at each new level, maxes at legend', () => {
    expect(levelProgress(0, T)).toBe(0); // start of newcomer→contributor
    expect(levelProgress(7.5, T)).toBeCloseTo(0.5, 5); // halfway to contributor
    expect(levelProgress(15, T)).toBe(0); // just reached contributor → resets
    expect(levelProgress(37.5, T)).toBeCloseTo(0.5, 5); // halfway contributor→trusted
    expect(levelProgress(600, T)).toBe(1); // legend is maxed
    // Always within [0,1].
    for (const rep of [0, 5, 15, 60, 199, 200, 499, 500, 5000]) {
      const p = levelProgress(rep, T);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});
