import { describe, it, expect } from 'vitest';
import { RATING_WEIGHT_DEFAULTS } from '@gameskeep/shared/constants';
import {
  aggregateCommunity,
  computeCredibility,
  detectBurst,
  disconnectBandFor,
  gap,
  normalizeCriticScore,
  type WeightedVote,
} from '../src/ratings/rating';

// All hermetic — no DB, no network. The full review-bomb scenario runs against
// the booted stack via scripts/i4b-check.mjs; these target the SPEC's headline:
// the model RESISTS a review-bomb while leaving a legitimate low score intact —
// without blanket-muting low votes.

const C = RATING_WEIGHT_DEFAULTS.credibility;
const B = RATING_WEIGHT_DEFAULTS.burst;
const D = RATING_WEIGHT_DEFAULTS.disconnect;

const PROVEN = {
  isEmailVerified: true,
  reputation: 80,
  accountAgeDays: 200,
  hasVerifiedPlaytime: false,
};
const UNPROVEN = {
  isEmailVerified: false,
  reputation: 0,
  accountAgeDays: 0,
  hasVerifiedPlaytime: false,
};

const minutes = (base: number, m: number): Date => new Date(base + m * 60_000);
const days = (base: number, d: number): Date => new Date(base - d * 86_400_000);

describe('credibility weight (per vote, 0 → 1.0)', () => {
  it('a proven voter reaches ~1.0; an unproven account is ~0; never above 1.0', () => {
    const proven = computeCredibility(PROVEN, C);
    const unproven = computeCredibility(UNPROVEN, C);
    expect(proven.total).toBeGreaterThanOrEqual(0.95);
    expect(proven.total).toBeLessThanOrEqual(1);
    expect(unproven.total).toBe(0);
  });

  it('engagement never inflates above 1.0 even with huge reputation', () => {
    const whale = computeCredibility({ ...PROVEN, reputation: 100_000 }, C);
    expect(whale.total).toBeLessThanOrEqual(1);
  });

  it('terms are transparent and sum to the total', () => {
    const c = computeCredibility(PROVEN, C);
    expect(Math.round((c.email + c.activity + c.age + c.playtime) * 1000) / 1000).toBeCloseTo(
      c.total,
      3,
    );
  });
});

/** Build proven (spread, score ~80) + unproven (clustered, score 0) vote sets. */
function reviewBombScenario(now: number): WeightedVote[] {
  const proven: WeightedVote[] = Array.from({ length: 12 }, (_, i) => ({
    score: 80,
    credibility: computeCredibility(PROVEN, C).total,
    ratedAt: days(now, 60 - i * 4), // spread over the past weeks
  }));
  const bomb: WeightedVote[] = Array.from({ length: 40 }, (_, i) => ({
    score: 0,
    credibility: computeCredibility(UNPROVEN, C).total,
    ratedAt: minutes(now, -i), // clustered in the last hour
  }));
  return [...proven, ...bomb];
}

describe('review-bomb resistance (the headline)', () => {
  it('flags the burst AND the weighted score barely moves while naive craters', () => {
    const now = Date.now();
    const votes = reviewBombScenario(now);
    const burst = detectBurst(votes, B);
    const agg = aggregateCommunity(votes, burst, B);

    // (a) flagged — burst volume + one-sided extremes
    expect(burst.flagged).toBe(true);
    expect(burst.extremeFraction).toBeGreaterThanOrEqual(B.extremeFraction);
    // (b) weighted ≈ the legitimate base; naive collapses (report BOTH)
    expect(agg.naive!).toBeLessThan(30);
    expect(agg.weighted!).toBeGreaterThan(70);
    expect(agg.weighted! - agg.naive!).toBeGreaterThan(40);
    // (c) nothing suppressed — every vote still counted
    expect(agg.count).toBe(52);
  });
});

describe('legitimate low score (the counter-case — must NOT blanket-mute)', () => {
  it('a proven moderate-low surge clears the volume bar but is NOT flagged, and DOES move the score', () => {
    const now = Date.now();
    const base: WeightedVote[] = Array.from({ length: 12 }, (_, i) => ({
      score: 80,
      credibility: computeCredibility(PROVEN, C).total,
      ratedAt: days(now, 60 - i * 4),
    }));
    // 20 PROVEN voters genuinely rate ~30 (moderate, NOT extreme), clustered now.
    const surge: WeightedVote[] = Array.from({ length: 20 }, (_, i) => ({
      score: 30,
      credibility: computeCredibility(PROVEN, C).total,
      ratedAt: minutes(now, -i),
    }));
    const votes = [...base, ...surge];
    const burst = detectBurst(votes, B);
    const agg = aggregateCommunity(votes, burst, B);

    // It IS a volume burst (20 ≥ minBurstVotes, well above the rate) — so "not
    // flagged" is provably about non-extremeness, not small size.
    expect(burst.windowCount).toBeGreaterThanOrEqual(B.minBurstVotes);
    expect(burst.isBurst).toBe(true);
    expect(burst.flagged).toBe(false); // 30 is not extreme → fails extremeFraction
    // And the legitimate dissatisfaction MOVES the number (proven = full weight).
    expect(agg.weighted!).toBeLessThan(60);
    expect(agg.weighted!).toBeGreaterThan(40);
    expect(agg.naive!).toBeLessThan(60);
  });
});

describe('first-ever surge with no prior history', () => {
  it('does NOT auto-flag purely from lack of history (extremeFraction is the gate)', () => {
    const now = Date.now();
    // A brand-new game: 20 votes, all at once, spread across scores (a real launch).
    const launch: WeightedVote[] = [
      40, 55, 70, 65, 80, 50, 60, 75, 45, 85, 62, 58, 72, 48, 68, 90, 35, 78, 52, 66,
    ].map((score, i) => ({ score, credibility: 0.5, ratedAt: minutes(now, -i) }));
    const burst = detectBurst(launch, B);
    expect(burst.historicalRate).toBe(0); // no prior votes
    expect(burst.isBurst).toBe(true); // a burst by volume…
    expect(burst.flagged).toBe(false); // …but spread, so NOT flagged
  });

  it('a first-ever EXTREME surge IS flagged', () => {
    const now = Date.now();
    const bomb: WeightedVote[] = Array.from({ length: 20 }, (_, i) => ({
      score: 0,
      credibility: 0,
      ratedAt: minutes(now, -i),
    }));
    expect(detectBurst(bomb, B).flagged).toBe(true);
  });

  it('a tiny surge below minBurstVotes is never a burst', () => {
    const now = Date.now();
    const few: WeightedVote[] = Array.from({ length: 5 }, (_, i) => ({
      score: 0,
      credibility: 0,
      ratedAt: minutes(now, -i),
    }));
    expect(detectBurst(few, B).isBurst).toBe(false);
  });
});

describe('credibility-aware damping (proven anger is never muted)', () => {
  it('a PROVEN voter caught in a flagged burst stays ~undamped', () => {
    const now = Date.now();
    // A genuine, extreme, proven-voter surge → flagged, but full-weight proven votes.
    const provenCred = computeCredibility(PROVEN, C).total;
    const surge: WeightedVote[] = Array.from({ length: 20 }, (_, i) => ({
      score: 5, // extreme low → flagged
      credibility: provenCred,
      ratedAt: minutes(now, -i),
    }));
    const burst = detectBurst(surge, B);
    expect(burst.flagged).toBe(true);
    const agg = aggregateCommunity(surge, burst, B);
    // Despite the flag, proven voters move the score (dampMult ≈ 1 for high cred).
    expect(agg.weighted!).toBeLessThan(15);
    expect(agg.dampedVoteCount).toBe(0); // proven cred ⇒ no meaningful damping
  });
});

describe('disconnect arithmetic + critic normalization + no-data', () => {
  it('bands by magnitude; gap is null when a pole is missing (no fabrication)', () => {
    expect(disconnectBandFor(5, D)).toBe('agree');
    expect(disconnectBandFor(20, D)).toBe('mild');
    expect(disconnectBandFor(35, D)).toBe('notable');
    expect(disconnectBandFor(50, D)).toBe('large');
    expect(gap(90, 45)).toBe(45);
    expect(gap(null, 45)).toBeNull(); // no data ≠ 0
    expect(gap(90, null)).toBeNull();
  });

  it('normalizes a native scale (8/10 → 80), else uses the stored 0..100', () => {
    expect(normalizeCriticScore(0, 8, 10)).toBe(80);
    expect(normalizeCriticScore(85, null, null)).toBe(85);
  });
});
