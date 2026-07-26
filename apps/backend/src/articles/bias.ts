import type {
  ArticleType,
  BiasBreakdown,
  BiasContribution,
  TopicBiasDistribution,
} from '@gameskeep/shared/constants';
import type { BiasBuckets, InfluenceWeights, QualityWeights } from './bias-settings';

/**
 * The BIAS ENGINE — pure compute (SPEC I4a §1/§2/§3). Kept free of DB imports so
 * the additive math and the public-payload boundary are unit-testable in
 * isolation. Two design rules the SPEC makes non-negotiable:
 *
 *  - TRANSPARENT ADDITIVE scoring: each score = baseline + Σ(named signal
 *    weights), CLAMPED to 0..100. The clamp IS the normalization, chosen so every
 *    point traces to exactly one `contributions` entry — no hidden interaction
 *    terms, nothing unexplainable.
 *  - FACTUAL signals only feed these. Judgmental observations (`editorNote`) and
 *    the internal assessment are NEVER computed here — they're editor-entered.
 *
 * Axis 1 (influence): 0 = Independent → 100 = Influenced.
 * Axis 2 (quality):   0 = Slop → 100 = Top (deliberately humbler/narrower).
 */

/** Factual inputs to the additive model — all derived from data I3 already captured. */
export interface BiasSignalInputs {
  isSponsored: boolean;
  hasAffiliateLinks: boolean;
  basedOnReviewCopy: boolean;
  isPaywalled: boolean;
  articleType: ArticleType;
  /** Source's parent company publishes a game this article covers (COI). */
  sourceConflict: boolean;
  /** Source baselines (0..1) or null when unknown. */
  reputationCommercial: number | null;
  reputationGeneral: number | null;
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function sum(contributions: BiasContribution[]): number {
  return contributions.reduce((acc, c) => acc + c.points, 0);
}

/** Axis 1 — Influenced ↔ Independent. Factual commercial/editorial signals. */
export function computeInfluence(s: BiasSignalInputs, w: InfluenceWeights): BiasBreakdown {
  const contributions: BiasContribution[] = [];

  let baseline = 0;
  if (s.reputationCommercial != null) {
    baseline = Math.round(s.reputationCommercial * w.sourceBaselineMax);
    if (baseline !== 0) {
      contributions.push({
        signal: 'sourceBaseline',
        label: 'Source commercial lean',
        points: baseline,
      });
    }
  }

  const add = (active: boolean, signal: string, label: string, points: number): void => {
    if (active && points !== 0) contributions.push({ signal, label, points });
  };
  add(s.isSponsored, 'sponsored', 'Sponsored / paid content', w.sponsored);
  add(
    s.sourceConflict,
    'sourceConflict',
    'Source covers a game its parent publishes',
    w.sourceConflict,
  );
  add(s.hasAffiliateLinks, 'affiliate', 'Affiliate links present', w.affiliate);
  add(
    s.articleType === 'opinion',
    'opinionFraming',
    'Opinion / editorial framing',
    w.opinionFraming,
  );
  add(s.basedOnReviewCopy, 'reviewCopy', 'Based on publisher review copy', w.reviewCopy);
  add(s.isPaywalled, 'paywall', 'Paywalled', w.paywall);

  const rawSum = sum(contributions);
  return { baseline, rawSum, score: clampScore(rawSum), contributions };
}

const QUALITY_TYPE_LABEL: Record<ArticleType, string> = {
  news: 'Article type: news',
  review: 'Article type: review (substantive)',
  opinion: 'Article type: opinion/analysis',
  preview: 'Article type: preview (often thin)',
  guide: 'Article type: guide',
};

/** Axis 2 — Slop ↔ Top. Consciously humbler: weak auto signals; editor leads. */
export function computeQuality(s: BiasSignalInputs, w: QualityWeights): BiasBreakdown {
  const contributions: BiasContribution[] = [];

  let baseline: number;
  if (s.reputationGeneral != null) {
    baseline = clampScore(w.baselineMid + s.reputationGeneral * w.sourceReputationMax);
    contributions.push({
      signal: 'sourceBaseline',
      label: 'Source quality baseline',
      points: baseline,
    });
  } else {
    // Unknown source reputation → neutral (not a crash, not fake precision).
    baseline = w.neutralDefault;
    contributions.push({
      signal: 'baselineNeutral',
      label: 'Neutral baseline (source reputation unknown)',
      points: baseline,
    });
  }

  const typeWeight: Record<ArticleType, number> = {
    news: w.typeNews,
    review: w.typeReview,
    opinion: w.typeOpinion,
    preview: w.typePreview,
    guide: w.typeGuide,
  };
  const tw = typeWeight[s.articleType] ?? 0;
  if (tw !== 0) {
    contributions.push({
      signal: `type:${s.articleType}`,
      label: QUALITY_TYPE_LABEL[s.articleType],
      points: tw,
    });
  }
  if (s.isSponsored && w.sponsored !== 0) {
    contributions.push({
      signal: 'sponsored',
      label: 'Sponsored / PR-style (lower effort)',
      points: w.sponsored,
    });
  }
  if (s.hasAffiliateLinks && w.affiliate !== 0) {
    contributions.push({
      signal: 'affiliate',
      label: 'Affiliate / deals content',
      points: w.affiliate,
    });
  }

  const rawSum = sum(contributions);
  return { baseline, rawSum, score: clampScore(rawSum), contributions };
}

// ── public-payload boundary (SPEC I4a §4 — the structural wall) ──────────────

/**
 * The minimal row shape the PUBLIC serializer reads. Deliberately does NOT
 * include `internalAssessment` — the internal-only field is not even in this
 * type, so it cannot be referenced when building public output.
 */
export interface PublicBiasSource {
  influenceScore: number | null;
  qualityScore: number | null;
  influenceOverride: number | null;
  qualityOverride: number | null;
  influenceBreakdown: BiasBreakdown | null;
  qualityBreakdown: BiasBreakdown | null;
  editorNote: string | null;
}

/** The public bias payload — what I5 renders. Has no internal-field slot. */
export interface PublicArticleBias {
  influenceScore: number | null;
  qualityScore: number | null;
  influenceBreakdown: BiasBreakdown | null;
  qualityBreakdown: BiasBreakdown | null;
  influenceEditorSet: boolean;
  qualityEditorSet: boolean;
  /** Human-written judgmental note (never auto-generated). */
  editorNote: string | null;
}

/**
 * The ONE sanctioned producer of public bias output (SPEC I4a §4). It builds the
 * DTO field-by-field from an ALLOWLIST — it never spreads the row — so the
 * internal-only assessment (or any future internal field) is structurally
 * incapable of appearing in a public payload, even if the caller passes a full
 * DB row. The effective public score is `override ?? auto`.
 */
export function toPublicBias(row: PublicBiasSource): PublicArticleBias {
  return {
    influenceScore: row.influenceOverride ?? row.influenceScore ?? null,
    qualityScore: row.qualityOverride ?? row.qualityScore ?? null,
    influenceBreakdown: row.influenceBreakdown ?? null,
    qualityBreakdown: row.qualityBreakdown ?? null,
    influenceEditorSet: row.influenceOverride != null,
    qualityEditorSet: row.qualityOverride != null,
    editorNote: row.editorNote ?? null,
  };
}

// ── topic-level aggregation (SPEC I4a §5; BLUEPRINT 1.3) ─────────────────────

export interface ArticleEffectiveScore {
  influence: number | null;
  quality: number | null;
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * Aggregate per-article EFFECTIVE scores into a topic distribution (the "bias
 * bar" data). Counts split at the tunable midpoints; averages alongside.
 */
export function aggregateDistribution(
  scores: ArticleEffectiveScore[],
  buckets: BiasBuckets,
): TopicBiasDistribution {
  const infValues: number[] = [];
  const qualValues: number[] = [];
  let independent = 0;
  let influenced = 0;
  let top = 0;
  let slop = 0;
  for (const s of scores) {
    if (s.influence != null) {
      infValues.push(s.influence);
      if (s.influence >= buckets.influenceMidpoint) influenced += 1;
      else independent += 1;
    }
    if (s.quality != null) {
      qualValues.push(s.quality);
      if (s.quality >= buckets.qualityMidpoint) top += 1;
      else slop += 1;
    }
  }
  return {
    articleCount: scores.length,
    influence: { independent, influenced, avg: avg(infValues) },
    quality: { top, slop, avg: avg(qualValues) },
    computedAt: new Date().toISOString(),
  };
}
