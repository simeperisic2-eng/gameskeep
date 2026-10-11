import type {
  BiasMode,
  InfluenceFlag,
  IntegrityTally,
  LatestArticle,
  PublicDisplay,
  TopicBiasDistribution,
  TopicFlagTally,
} from '@/lib/public-api';
import {
  FLAG_LABEL,
  NO_SIGNALS_EXPLAINER,
  NO_SIGNALS_LABEL,
  compactTopicToken,
  flagParts,
  qualityReadout,
  type BiasTone,
  type FlagPart,
} from '@/lib/bias';

/**
 * The BIAS DISPLAY — GamesKeep's transparency surface (SPEC I5a; Phase P S1).
 *
 *  - INFLUENCE is mostly binary FACTS (sponsored or not, affiliate or not, opinion
 *    frame or not), shown as small chips. Where nothing was found the chip reads
 *    "No signals found" in a NEUTRAL style — we prove presence, never absence, so
 *    an empty result is never dressed up as "clean".
 *  - QUALITY is a gradient bar — rendered only while the admin shows it (the
 *    payload carries no quality values otherwise).
 *
 * WHERE it renders is the display scope, decided server-side (rows) / by the
 * topic's `showPanel`. Leak-proof: consumes only public flags and distributions.
 */
function pct(part: number, total: number): number {
  return total <= 0 ? 0 : Math.round((part / total) * 100);
}

function toneClass(t: BiasTone): string {
  return `tone-${t}`;
}

/** The quality scale (genuinely a gradient) — only while shown. */
function QualityTrack({ top, slop }: { top: number; slop: number }): React.JSX.Element {
  const total = top + slop;
  const topPct = pct(top, total);
  return (
    <div className="gk-bias-track thin" aria-hidden>
      {top > 0 && <span className="gk-bias-seg good" style={{ width: `${topPct}%` }} />}
      {slop > 0 && <span className="gk-bias-seg bad" style={{ width: `${100 - topPct}%` }} />}
    </div>
  );
}

/** A row of topic-level flag chips. */
function FlagChips({ parts }: { parts: FlagPart[] }): React.JSX.Element {
  if (parts.length === 0) {
    return <span className="gk-bias-empty">Coverage signals pending</span>;
  }
  return (
    <span className="gk-flags">
      {parts.map((p) => (
        <span key={p.key} className={`gk-flag ${p.kind}`}>
          {p.label}
        </span>
      ))}
    </span>
  );
}

function whyText(
  flags: TopicFlagTally,
  distribution: TopicBiasDistribution,
  integrity?: IntegrityTally,
): React.JSX.Element {
  const signals = flagParts(flags, integrity).filter((p) => p.kind === 'signal');
  return (
    <>
      Across <b>{flags.total}</b> {flags.total === 1 ? 'article' : 'articles'},{' '}
      {signals.length > 0 ? (
        <>
          {signals.map((p, i) => (
            <span key={p.key}>
              {i > 0 ? ', ' : ''}
              <b>{p.label}</b>
            </span>
          ))}{' '}
          — factual labels (what the coverage carries), not a judgment of quality.
        </>
      ) : (
        <>
          <b>{NO_SIGNALS_LABEL.toLowerCase()}</b> (sponsored, affiliate, review copy, opinion).{' '}
          {NO_SIGNALS_EXPLAINER}
        </>
      )}
      {distribution.quality ? (
        <>
          {' '}
          Separately, quality reads <b>{distribution.quality.top}</b> higher-effort and{' '}
          <b>{distribution.quality.slop}</b> low-effort.
        </>
      ) : null}{' '}
      Open the story for each source&apos;s signals.
    </>
  );
}

/** Topic-level panel — flag distribution (+ quality while shown). Hero + story page. */
export function BiasBar({
  flags,
  distribution,
  integrity,
  sourceCount = 0,
  showWhy = true,
}: {
  flags: TopicFlagTally;
  distribution: TopicBiasDistribution;
  /** Public integrity rows found on the story's reviews (embargo / press trip). */
  integrity?: IntegrityTally;
  sourceCount?: number;
  showWhy?: boolean;
}): React.JSX.Element {
  const quality = distribution.quality;
  const qual = quality ? qualityReadout(quality.top, quality.slop) : null;
  return (
    <div className="gk-biasbar">
      <div className="gk-bias-axis">
        <div className="gk-bias-axis-head">
          <span className="gk-bias-axis-name">
            Influence <small>· what the coverage carries</small>
          </span>
          {sourceCount > 0 && (
            <span className="gk-bias-srcs">
              {sourceCount} {sourceCount === 1 ? 'source' : 'sources'}
            </span>
          )}
        </div>
        <FlagChips parts={flagParts(flags, integrity)} />
      </div>
      {quality && qual ? (
        <div className="gk-bias-axis">
          <div className="gk-bias-axis-head">
            <span className="gk-bias-axis-name">
              Quality <small>· Low-effort / AI ↔ Quality</small>
            </span>
            <span className={`gk-bias-phrase ${toneClass(qual.tone)}`}>{qual.phrase}</span>
          </div>
          <QualityTrack top={quality.top} slop={quality.slop} />
        </div>
      ) : null}
      {showWhy && (
        <details className="gk-bias-why">
          <summary className="gk-chip">Why these signals?</summary>
          <div className="gk-bias-whycard">{whyText(flags, distribution, integrity)}</div>
        </details>
      )}
    </div>
  );
}

/**
 * Compact topic signal for cards: default scope → a Sponsored chip only when a
 * sponsored article is present (else just the source count); scope `all` → the
 * leading signal or the neutral no-signal chip.
 */
export function BiasMini({
  flags,
  integrity,
  sourceCount = 0,
  display,
}: {
  flags: TopicFlagTally;
  integrity?: IntegrityTally;
  sourceCount?: number;
  display: PublicDisplay;
}): React.JSX.Element | null {
  const token = compactTopicToken(flags, display.scope, integrity);
  if (!token && sourceCount <= 0) return null;
  return (
    <span className="gk-biasmini">
      {token ? <span className={`gk-flag ${token.kind}`}>{token.label}</span> : null}
      {sourceCount > 0 && (
        <span className="gk-bias-srcs">
          {sourceCount} {sourceCount === 1 ? 'source' : 'sources'}
        </span>
      )}
    </span>
  );
}

/**
 * A single article's signal chips + hover "why", shaped server-side by `mode`:
 * `none` renders nothing, `chip` a lone Sponsored chip, `panel` every public flag
 * or the neutral "No signals found" chip.
 */
export function ArticleFlags({
  flags,
  reasons,
  mode,
}: {
  flags: InfluenceFlag[];
  reasons: string[];
  mode: BiasMode;
}): React.JSX.Element | null {
  if (mode === 'none') return null;
  if (mode === 'chip') {
    return flags.includes('sponsored') ? (
      <span className="gk-flags">
        <span className="gk-flag signal">{FLAG_LABEL.sponsored}</span>
      </span>
    ) : null;
  }
  return (
    <span className="gk-tip">
      <span className="gk-flags" tabIndex={0}>
        {flags.length > 0 ? (
          flags.map((f) => (
            <span key={f} className="gk-flag signal">
              {FLAG_LABEL[f]}
            </span>
          ))
        ) : (
          <span className="gk-flag nosignal">{NO_SIGNALS_LABEL}</span>
        )}
      </span>
      <span className="gk-tip-card" role="tooltip">
        {flags.length === 0 ? (
          <>
            {NO_SIGNALS_LABEL} for sponsored, affiliate or opinion signals. {NO_SIGNALS_EXPLAINER}
          </>
        ) : (
          <>
            Carries: <b>{flags.map((f) => FLAG_LABEL[f]).join(', ')}</b>. These are factual labels
            (what the article is), not a judgment of quality.
            {reasons.length > 0 ? <> Signals: {reasons.join(', ')}.</> : null}
          </>
        )}
      </span>
    </span>
  );
}

/** The "Latest news" column variant — reads its (server-shaped) flags off a LatestArticle. */
export function ArticleBiasTag({ article }: { article: LatestArticle }): React.JSX.Element | null {
  return <ArticleFlags flags={article.flags} reasons={article.reasons} mode={article.biasMode} />;
}
