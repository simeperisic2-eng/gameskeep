import type {
  CommunityBurstInfo,
  CredibilityBreakdown,
  DisconnectBand,
} from '@gameskeep/shared/constants';

/**
 * The RATING ENGINE — pure compute (SPEC I4b). DB-free so the weighting math, the
 * burst detector and the disconnect arithmetic are unit-testable in isolation —
 * the headline review-bomb test runs against these.
 *
 * The architecture the SPEC fixes (BLUEPRINT 2.6): two INDEPENDENT mechanisms.
 *   - CREDIBILITY (0→1.0 per vote) drives SCORE RESISTANCE — it is the PRIMARY
 *     defense against a large-volume attack (unproven votes → ~0 weight). Never
 *     above 1.0; engagement never inflates a vote.
 *   - BURST + EXTREME detection drives the FLAG (and a secondary, visible,
 *     credibility-aware damping). A genuine moderate-low surge from proven voters
 *     is neither muted (full weight) nor flagged (not extreme); an extreme surge
 *     from throwaways is both.
 * Critics are NEVER touched by any of this.
 */

// ── settings shapes (the store in rating-settings.ts fills these from app_settings) ──
export interface CredibilitySettings {
  email: number;
  activity: number;
  age: number;
  playtime: number;
  activityFullRep: number;
  ageFullDays: number;
}
export interface BurstSettings {
  windowHours: number;
  minBurstVotes: number;
  burstMultiplier: number;
  extremeLow: number;
  extremeHigh: number;
  extremeFraction: number;
  dampingFactor: number;
}
export interface DisconnectSettings {
  agreeMax: number;
  mildMax: number;
  notableMax: number;
  tagMinValue: number;
}
export interface RatingSettings {
  credibility: CredibilitySettings;
  burst: BurstSettings;
  disconnect: DisconnectSettings;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const clampScore = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

// ── 1. credibility weight (per vote, 0 → 1.0) ────────────────────────────────
export interface CredibilityInputs {
  isEmailVerified: boolean;
  reputation: number;
  accountAgeDays: number;
  hasVerifiedPlaytime: boolean;
}

/** Transparent additive credibility: weight = clamp(Σ named terms, 0, 1). */
export function computeCredibility(
  inputs: CredibilityInputs,
  w: CredibilitySettings,
): CredibilityBreakdown {
  const email = inputs.isEmailVerified ? w.email : 0;
  const activity = w.activity * clamp01(inputs.reputation / Math.max(1, w.activityFullRep));
  const age = w.age * clamp01(inputs.accountAgeDays / Math.max(1, w.ageFullDays));
  const playtime = inputs.hasVerifiedPlaytime ? w.playtime : 0;
  const total = clamp01(email + activity + age + playtime);
  return {
    email: round3(email),
    activity: round3(activity),
    age: round3(age),
    playtime: round3(playtime),
    total: round3(total),
  };
}

// ── 2. burst / anomaly detection ─────────────────────────────────────────────
export interface VoteForBurst {
  score: number; // 0..100
  ratedAt: Date;
}

export interface BurstResult {
  isBurst: boolean; // volume spike (independent of extremeness)
  flagged: boolean; // isBurst AND one-sided extremes → the review-bomb signature
  windowHours: number;
  windowCount: number;
  historicalRate: number;
  extremeFraction: number;
  /** Parallel to the time-sorted votes: which fall inside the detection window. */
  inWindow: boolean[];
}

/**
 * Two INDEPENDENT conditions; the flag needs both. `isBurst` = an abnormal volume
 * spike; `flagged` = that spike is also one-sided at the extremes. A first-ever
 * surge (no prior history) has `historicalRate = 0`, so the multiplier test is
 * vacuous and `isBurst` reduces to the `minBurstVotes` floor — a legit launch
 * wave can be a "burst" by volume but is NOT flagged unless it's also extreme.
 */
export function detectBurst(votes: VoteForBurst[], b: BurstSettings): BurstResult {
  const empty: BurstResult = {
    isBurst: false,
    flagged: false,
    windowHours: b.windowHours,
    windowCount: 0,
    historicalRate: 0,
    extremeFraction: 0,
    inWindow: [],
  };
  if (votes.length === 0) return empty;

  const sorted = [...votes].sort((a, c) => a.ratedAt.getTime() - c.ratedAt.getTime());
  const latest = sorted[sorted.length - 1]!.ratedAt.getTime();
  const windowMs = b.windowHours * 3_600_000;
  const windowStart = latest - windowMs;

  const inWindow = sorted.map((v) => v.ratedAt.getTime() >= windowStart);
  const windowVotes = sorted.filter((_, i) => inWindow[i]);
  const priorVotes = sorted.filter((_, i) => !inWindow[i]);
  const windowCount = windowVotes.length;

  // Historical rate = prior votes expressed as "votes per window of this size".
  let historicalRate = 0;
  if (priorVotes.length > 0) {
    const earliest = priorVotes[0]!.ratedAt.getTime();
    const spanMs = Math.max(windowStart - earliest, windowMs);
    historicalRate = priorVotes.length / (spanMs / windowMs);
  }

  const isBurst =
    windowCount >= b.minBurstVotes && windowCount >= b.burstMultiplier * historicalRate;

  const extremeCount = windowVotes.filter(
    (v) => v.score <= b.extremeLow || v.score >= b.extremeHigh,
  ).length;
  const extremeFraction = windowCount > 0 ? round3(extremeCount / windowCount) : 0;

  const flagged = isBurst && extremeFraction >= b.extremeFraction;

  return {
    isBurst,
    flagged,
    windowHours: b.windowHours,
    windowCount,
    historicalRate: round3(historicalRate),
    extremeFraction,
    inWindow,
  };
}

// ── 3. weighted community aggregate (credibility + credibility-aware damping) ──
export interface WeightedVote {
  score: number;
  credibility: number; // 0..1
  ratedAt: Date;
}

export interface CommunityAggregate {
  weighted: number | null; // null = no credible weight (e.g. only low-trust votes)
  naive: number | null; // unweighted mean (for the naive-vs-weighted comparison)
  count: number;
  dampedVoteCount: number;
}

/**
 * Weighted mean using credibility, with credibility-aware damping ONLY on a
 * flagged burst cohort: dampMult = dampingFactor + (1−dampingFactor)·credibility.
 * A zero-credibility burst vote → ×dampingFactor; a PROVEN voter caught in the
 * same flagged burst → ≈×1.0 (essentially undamped — legitimate anger is never
 * muted). Returns `naive` regardless so callers can show both numbers.
 */
export function aggregateCommunity(
  votes: WeightedVote[],
  burst: BurstResult,
  b: BurstSettings,
): CommunityAggregate {
  if (votes.length === 0) return { weighted: null, naive: null, count: 0, dampedVoteCount: 0 };

  const sorted = [...votes].sort((a, c) => a.ratedAt.getTime() - c.ratedAt.getTime());
  let weightSum = 0;
  let weightedScoreSum = 0;
  let scoreSum = 0;
  let damped = 0;

  sorted.forEach((v, i) => {
    const inFlaggedBurst = burst.flagged && (burst.inWindow[i] ?? false);
    const dampMult = inFlaggedBurst ? b.dampingFactor + (1 - b.dampingFactor) * v.credibility : 1;
    if (inFlaggedBurst && dampMult < 0.999) damped += 1;
    const eff = v.credibility * dampMult;
    weightSum += eff;
    weightedScoreSum += eff * v.score;
    scoreSum += v.score;
  });

  return {
    weighted: weightSum > 1e-9 ? clampScore(weightedScoreSum / weightSum) : null,
    naive: clampScore(scoreSum / sorted.length),
    count: sorted.length,
    dampedVoteCount: damped,
  };
}

/** Assemble the stored, public-facing burst info (never silent). */
export function toBurstInfo(burst: BurstResult, agg: CommunityAggregate): CommunityBurstInfo {
  return {
    isBurst: burst.isBurst,
    flagged: burst.flagged,
    windowHours: burst.windowHours,
    windowCount: burst.windowCount,
    historicalRate: burst.historicalRate,
    extremeFraction: burst.extremeFraction,
    naive: agg.naive,
    weighted: agg.weighted,
    dampedVoteCount: agg.dampedVoteCount,
  };
}

// ── 4. critic normalization + disconnect ─────────────────────────────────────
/** Normalize an outlet score to 0..100 (native scale where given, else the stored 0..100). */
export function normalizeCriticScore(
  score: number,
  nativeScore: number | null,
  nativeScaleMax: number | null,
): number {
  if (nativeScore != null && nativeScaleMax != null && nativeScaleMax > 0) {
    return clampScore((nativeScore / nativeScaleMax) * 100);
  }
  return clampScore(score);
}

export function disconnectBandFor(value: number, d: DisconnectSettings): DisconnectBand {
  if (value <= d.agreeMax) return 'agree';
  if (value <= d.mildMax) return 'mild';
  if (value <= d.notableMax) return 'notable';
  return 'large';
}

/** Absolute gap between two layers, or null when either pole is missing (no fabrication). */
export function gap(a: number | null, c: number | null): number | null {
  if (a == null || c == null) return null;
  return Math.abs(a - c);
}
