import { computeCredibility, type CredibilitySettings } from '../ratings/rating';

/**
 * Uniform credibility weighting for the NON-rating community signals (SPEC I6,
 * Slice 4, decision 13: "topic bias-votes and article trust-votes get the same
 * treatment as game ratings, so no signal is undefended"). Game ratings already
 * flow through the I4b engine's burst-aware aggregation; trust-votes, bias-votes
 * and hype are lower-volume and burst-free, so they reuse the SAME per-vote
 * credibility curve (`computeCredibility`) with a light weighted mean here —
 * cheap enough to compute on read and always fresh (a voter's reputation/age is
 * read live, never a stale snapshot).
 *
 * Playtime is a game-specific proof, so it is `false` for these signals — the
 * weight comes from verified-email + reputation + account age.
 */
const MS_PER_DAY = 86_400_000;

export interface VoterFields {
  isEmailVerified: boolean;
  reputation: number;
  createdAt: Date;
}

/** The 0→1.0 credibility weight of a voter for a non-rating signal. */
export function voterCredibility(u: VoterFields, w: CredibilitySettings, now = Date.now()): number {
  return computeCredibility(
    {
      isEmailVerified: u.isEmailVerified,
      reputation: u.reputation,
      accountAgeDays: Math.max(0, (now - u.createdAt.getTime()) / MS_PER_DAY),
      hasVerifiedPlaytime: false,
    },
    w,
  ).total;
}

export interface WeightedVote {
  value: number; // e.g. +1/-1 (trust), -1/0/+1 (bias axis), 1 (hype presence)
  credibility: number; // 0..1
}

export interface WeightedAggregate {
  /** Credibility-weighted mean of the values (null when no credible weight). */
  weightedMean: number | null;
  /** Unweighted mean, kept so callers can show weighted-vs-naive (transparency). */
  naiveMean: number | null;
  /** Σ credibility — the "effective" (credibility-discounted) vote mass. */
  weightSum: number;
  /** Raw number of votes. */
  count: number;
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Weighted + naive means of a set of already-credibility-scored votes. */
export function weightedAggregate(votes: WeightedVote[]): WeightedAggregate {
  if (votes.length === 0) return { weightedMean: null, naiveMean: null, weightSum: 0, count: 0 };
  let weightSum = 0;
  let weightedValueSum = 0;
  let valueSum = 0;
  for (const v of votes) {
    weightSum += v.credibility;
    weightedValueSum += v.credibility * v.value;
    valueSum += v.value;
  }
  return {
    weightedMean: weightSum > 1e-9 ? round3(weightedValueSum / weightSum) : null,
    naiveMean: round3(valueSum / votes.length),
    weightSum: round3(weightSum),
    count: votes.length,
  };
}
