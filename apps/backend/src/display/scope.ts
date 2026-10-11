import {
  INFLUENCE_FLAGS,
  type BiasBreakdown,
  type BiasDisplayScope,
  type InfluenceFlag,
  type IntegritySignalKind,
  type TopicFlagTally,
} from '@gameskeep/shared/constants';

/**
 * Display-scope rules (Phase P S1) — PURE, so every public surface agrees and the
 * rules are unit-tested. The engine computes on every article; these decide only
 * what a public payload SHOWS.
 */

/**
 * How one article row shows its bias signals: `panel` = the full flag set (+ the
 * integrity block on reviews), `chip` = only a Sponsored chip, `none` = nothing.
 */
export type BiasMode = 'panel' | 'chip' | 'none';

/**
 * Map a stored breakdown signal → its public FLAG. Only the four named factual
 * flags surface publicly; baselines and the (dormant) source-conflict signal
 * still feed the influence SCORE but are not shown as chips.
 */
const FLAG_BY_SIGNAL: Record<string, InfluenceFlag> = {
  sponsored: 'sponsored',
  affiliate: 'affiliate',
  reviewCopy: 'reviewCopy',
  opinionFraming: 'opinion',
};

/** The factual influence flags in a stored breakdown (engine view, canonical order). */
export function flagsFromBreakdown(breakdown: BiasBreakdown | null): InfluenceFlag[] {
  if (!breakdown) return [];
  const present = new Set<InfluenceFlag>();
  for (const c of breakdown.contributions) {
    if (c.points > 0) {
      const flag = FLAG_BY_SIGNAL[c.signal];
      if (flag) present.add(flag);
    }
  }
  return INFLUENCE_FLAGS.filter((f) => present.has(f));
}

/**
 * The PUBLIC influence flags of an article (Phase P S1 owner rule). The engine's
 * breakdown flags, except a REVIEW's "review copy": for reviews the engine infers
 * it from the article type — an inference, not evidence — so on a review it
 * shows only when a public integrity row backs it. (For non-reviews the flag can
 * only come from provider/text evidence, so it passes through.) The internal
 * scores keep using the inference; no public chip, count, sort or filter does.
 */
export function publicFlags(
  breakdown: BiasBreakdown | null,
  articleType: string,
  reviewCopyEvidence: boolean,
): InfluenceFlag[] {
  const isReview = articleType === 'review';
  const present = new Set(flagsFromBreakdown(breakdown));
  if (isReview) present.delete('reviewCopy');
  if (isReview && reviewCopyEvidence) present.add('reviewCopy');
  return INFLUENCE_FLAGS.filter((f) => present.has(f));
}

/**
 * How a row shows its signals. `detail` lists (topic coverage, game Reviews/news,
 * source coverage) give reviews + sponsored rows the full panel; `compact` spots
 * (the Latest column) show at most a Sponsored chip. Scope `all` = panel everywhere.
 */
export function rowBiasMode(
  scope: BiasDisplayScope,
  surface: 'detail' | 'compact',
  isReview: boolean,
  flags: InfluenceFlag[],
): BiasMode {
  if (scope === 'all') return 'panel';
  const sponsored = flags.includes('sponsored');
  if (surface === 'detail') return isReview || sponsored ? 'panel' : 'none';
  return sponsored ? 'chip' : 'none';
}

/**
 * Shape a row's flags + reasons for its mode, server-side (hidden flags never
 * reach the page). On a review's panel the review-copy evidence lives in the
 * integrity block, not a chip.
 */
export function shapeRowSignals(
  mode: BiasMode,
  isReview: boolean,
  flags: InfluenceFlag[],
  reasons: string[],
): { flags: InfluenceFlag[]; reasons: string[] } {
  if (mode === 'none') return { flags: [], reasons: [] };
  if (mode === 'chip') {
    return { flags: flags.includes('sponsored') ? ['sponsored'] : [], reasons: [] };
  }
  return { flags: isReview ? flags.filter((f) => f !== 'reviewCopy') : flags, reasons };
}

/** Topic-level panel rule: reviews or a sponsored article (default scope); `all` always. */
export function topicShowsPanel(
  scope: BiasDisplayScope,
  tally: TopicFlagTally,
  reviews: number,
): boolean {
  return scope === 'all' || reviews > 0 || tally.sponsored > 0;
}

/** Public integrity rows beyond review copy (which is counted as a flag). */
export interface IntegrityTally {
  embargo: number;
  sponsoredEvent: number;
}

export function emptyIntegrityTally(): IntegrityTally {
  return { embargo: 0, sponsoredEvent: 0 };
}

/**
 * Add one article's PUBLIC signals to a topic/source tally. "No signals found"
 * (internal key `independent`) only when NOTHING public was found — no flag AND
 * no integrity row — so a panel never says "no signals" about an article whose
 * row shows, e.g., a confirmed embargo.
 */
export function tallyArticle(
  tally: TopicFlagTally,
  integrity: IntegrityTally,
  flags: InfluenceFlag[],
  kinds: ReadonlySet<IntegritySignalKind> | undefined,
): void {
  tally.total += 1;
  const embargo = kinds?.has('embargo') ?? false;
  const sponsoredEvent = kinds?.has('sponsored_event') ?? false;
  if (embargo) integrity.embargo += 1;
  if (sponsoredEvent) integrity.sponsoredEvent += 1;
  for (const f of flags) tally[f] += 1;
  if (flags.length === 0 && !embargo && !sponsoredEvent) tally.independent += 1;
}
