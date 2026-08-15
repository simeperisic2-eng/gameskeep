import { describe, expect, it } from 'vitest';
import { RATING_WEIGHT_DEFAULTS } from '@gameskeep/shared/constants';
import {
  communityBiasVoteInput,
  communityCommentInput,
  communityRatingInput,
  communityReactionInput,
  communityTrustVoteInput,
  followEntityParam,
} from '@gameskeep/shared/validation';
import { voterCredibility, weightedAggregate } from '../src/community/weighting';

/**
 * Hermetic I6 Slice-4 tests — the pure weighting curve (decision 13: the SAME
 * credibility treatment ratings get, applied to trust/bias/hype) and the public
 * write-input validation. The live attack-path proofs (verified-email gate,
 * CSRF, rate limit, one-per-user, UGC escaping, auto-hide, and the review-bomb
 * re-run through the real write flow) run in scripts/i6-check.mjs.
 */
const W = RATING_WEIGHT_DEFAULTS.credibility;
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

describe('community: uniform credibility weighting (decision 13)', () => {
  it('an unverified brand-new account weighs ~0; a verified aged reputable one ~1.0', () => {
    const throwaway = voterCredibility(
      { isEmailVerified: false, reputation: 0, createdAt: daysAgo(0) },
      W,
    );
    const proven = voterCredibility(
      { isEmailVerified: true, reputation: 80, createdAt: daysAgo(60) },
      W,
    );
    expect(throwaway).toBe(0);
    expect(proven).toBeGreaterThan(0.95);
    // A JUST-verified newcomer sits in between — the email term alone, no farm.
    const freshVerified = voterCredibility(
      { isEmailVerified: true, reputation: 0, createdAt: daysAgo(0) },
      W,
    );
    expect(freshVerified).toBeGreaterThan(0);
    expect(freshVerified).toBeLessThan(proven);
  });

  it('weights the aggregate toward credible voters (weighted ≠ naive under attack)', () => {
    // One proven +1 vs many throwaway -1: naive is strongly negative, weighted
    // is dominated by the single credible vote.
    const votes = [
      { value: 1, credibility: 1.0 },
      { value: -1, credibility: 0.0 },
      { value: -1, credibility: 0.0 },
      { value: -1, credibility: 0.0 },
    ];
    const agg = weightedAggregate(votes);
    expect(agg.count).toBe(4);
    expect(agg.naiveMean).toBeLessThan(0); // -0.5 — a naive count is swamped
    expect(agg.weightedMean).toBe(1); // the only credible weight is the +1
  });

  it('returns nulls (never a fabricated 0) when there is no credible weight', () => {
    const agg = weightedAggregate([
      { value: 1, credibility: 0 },
      { value: -1, credibility: 0 },
    ]);
    expect(agg.weightedMean).toBeNull();
    expect(agg.naiveMean).toBe(0);
    expect(weightedAggregate([]).weightedMean).toBeNull();
  });
});

describe('community: public write validation', () => {
  it('rating accepts 0..100 and rejects out-of-range / non-integer', () => {
    expect(communityRatingInput.safeParse({ score: 73 }).success).toBe(true);
    expect(communityRatingInput.safeParse({ score: 0 }).success).toBe(true);
    expect(communityRatingInput.safeParse({ score: 101 }).success).toBe(false);
    expect(communityRatingInput.safeParse({ score: -1 }).success).toBe(false);
    expect(communityRatingInput.safeParse({ score: 50.5 }).success).toBe(false);
  });

  it('trust vote is exactly ±1', () => {
    expect(communityTrustVoteInput.safeParse({ value: 1 }).success).toBe(true);
    expect(communityTrustVoteInput.safeParse({ value: -1 }).success).toBe(true);
    expect(communityTrustVoteInput.safeParse({ value: 0 }).success).toBe(false);
    expect(communityTrustVoteInput.safeParse({ value: 2 }).success).toBe(false);
  });

  it('bias vote needs a known axis and a −1/0/+1 value', () => {
    expect(communityBiasVoteInput.safeParse({ axis: 'influence', value: 1 }).success).toBe(true);
    expect(communityBiasVoteInput.safeParse({ axis: 'quality', value: 0 }).success).toBe(true);
    expect(communityBiasVoteInput.safeParse({ axis: 'nonsense', value: 1 }).success).toBe(false);
    expect(communityBiasVoteInput.safeParse({ axis: 'trust', value: 5 }).success).toBe(false);
  });

  it('comment rejects empty/whitespace and caps length; reaction needs a known kind', () => {
    expect(communityCommentInput.safeParse({ body: 'nice write-up' }).success).toBe(true);
    expect(communityCommentInput.safeParse({ body: '   ' }).success).toBe(false);
    expect(communityCommentInput.safeParse({ body: 'x'.repeat(4001) }).success).toBe(false);
    expect(communityReactionInput.safeParse({ kind: 'insightful' }).success).toBe(true);
    expect(communityReactionInput.safeParse({ kind: 'rocket' }).success).toBe(false);
  });

  it('a raw <script> comment is accepted verbatim (stored raw, escaped at render)', () => {
    const payload = '<script>alert(1)</script>';
    const parsed = communityCommentInput.safeParse({ body: payload });
    expect(parsed.success).toBe(true);
    // Validation must NOT mangle/strip it — escaping is the render layer's job.
    expect(parsed.success && parsed.data.body).toBe(payload);
  });

  it('follow target accepts a game/topic + lowercase slug, rejects other types / bad slugs (I6 Slice 6)', () => {
    expect(
      followEntityParam.safeParse({ entityType: 'game', slug: 'baldurs-gate-3' }).success,
    ).toBe(true);
    expect(
      followEntityParam.safeParse({ entityType: 'topic', slug: 'the-witcher-4' }).success,
    ).toBe(true);
    expect(followEntityParam.safeParse({ entityType: 'article', slug: 'x' }).success).toBe(false);
    expect(followEntityParam.safeParse({ entityType: 'game', slug: 'Bad Slug!' }).success).toBe(
      false,
    );
    expect(followEntityParam.safeParse({ entityType: 'game', slug: '../etc' }).success).toBe(false);
  });
});
