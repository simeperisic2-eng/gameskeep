import type {
  InfluenceFlag,
  LatestArticle,
  TopicBiasDistribution,
  TopicFlagTally,
} from '@/lib/public-api';
import { FLAG_LABEL, flagParts, qualityReadout, type BiasTone, type FlagPart } from '@/lib/bias';

/**
 * The BIAS DISPLAY — GamesKeep's signature transparency surface. The two axes have
 * different natures, so they read differently (deliberate, SPEC I5a):
 *
 *  - INFLUENCE is mostly binary FACTS (sponsored or not, affiliate or not, review
 *    copy or not, opinion frame or not). A bar would imply a smooth "62%
 *    influenced" scale that doesn't exist — so we show the actual signals present
 *    as small chips ("Sponsored", "Affiliate"), or a single "Independent" chip
 *    when none fire. At the TOPIC level it's a distribution of those flags across
 *    the cluster's articles ("5 independent · 1 sponsored"). These are LABELS,
 *    never a verdict — neutral/amber in the UI, never red.
 *  - QUALITY is a genuine GRADIENT (low-effort/AI → in-depth), so it keeps the
 *    bar/scale plus a plain-language readout.
 *
 * Both keep the hover "why" (the I4a breakdown). Leak-proof: consumes only the
 * public flags/distribution — the internal-only assessment is not in these types
 * and is never referenced.
 */
function pct(part: number, total: number): number {
  return total <= 0 ? 0 : Math.round((part / total) * 100);
}

function toneClass(t: BiasTone): string {
  return `tone-${t}`;
}

/** The kept QUALITY scale (genuinely a gradient). */
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

/** A row of influence flag chips (topic-level distribution, or a lone Independent). */
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

function whyText(flags: TopicFlagTally, distribution: TopicBiasDistribution): React.JSX.Element {
  const parts = flagParts(flags);
  const signal = parts.filter((p) => p.kind === 'signal');
  return (
    <>
      Across <b>{flags.total}</b> {flags.total === 1 ? 'article' : 'articles'},{' '}
      {signal.length > 0 ? (
        <>
          {parts.map((p, i) => (
            <span key={p.key}>
              {i > 0 ? ', ' : ''}
              <b>{p.label}</b>
            </span>
          ))}{' '}
          — these are factual labels (what the coverage carries), not a judgment of quality.
        </>
      ) : (
        <>
          all <b>independent</b> — no sponsored, affiliate, review-copy or opinion signals detected.
        </>
      )}{' '}
      Separately, quality reads <b>{distribution.quality.top}</b> higher-effort and{' '}
      <b>{distribution.quality.slop}</b> low-effort. Open the story for each source&apos;s reasons.
    </>
  );
}

/** Full bias display — flag distribution + the quality scale (hero spotlight + story page). */
export function BiasBar({
  flags,
  distribution,
  sourceCount = 0,
  showWhy = true,
}: {
  flags: TopicFlagTally;
  distribution: TopicBiasDistribution;
  sourceCount?: number;
  showWhy?: boolean;
}): React.JSX.Element {
  const qual = qualityReadout(distribution.quality.top, distribution.quality.slop);
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
        <FlagChips parts={flagParts(flags)} />
      </div>
      <div className="gk-bias-axis">
        <div className="gk-bias-axis-head">
          <span className="gk-bias-axis-name">
            Quality <small>· Low-effort / AI ↔ Quality</small>
          </span>
          <span className={`gk-bias-phrase ${toneClass(qual.tone)}`}>{qual.phrase}</span>
        </div>
        <QualityTrack top={distribution.quality.top} slop={distribution.quality.slop} />
      </div>
      {showWhy && (
        <details className="gk-bias-why">
          <summary className="gk-chip">Why these signals?</summary>
          <div className="gk-bias-whycard">{whyText(flags, distribution)}</div>
        </details>
      )}
    </div>
  );
}

/** Mini influence — the flag distribution as compact chips + hover "why" (feed cards). */
export function BiasMini({
  flags,
  sourceCount = 0,
  distribution,
}: {
  flags: TopicFlagTally;
  sourceCount?: number;
  distribution: TopicBiasDistribution;
}): React.JSX.Element {
  const parts = flagParts(flags);
  return (
    <span className="gk-tip gk-biasmini">
      <span className="gk-flags" tabIndex={0}>
        {parts.length > 0 ? (
          parts.map((p) => (
            <span key={p.key} className={`gk-flag ${p.kind}`}>
              {p.label}
            </span>
          ))
        ) : (
          <span className="gk-flag independent">Independent</span>
        )}
      </span>
      {sourceCount > 0 && (
        <span className="gk-bias-srcs">
          {sourceCount} {sourceCount === 1 ? 'source' : 'sources'}
        </span>
      )}
      <span className="gk-tip-card" role="tooltip">
        {whyText(flags, distribution)}
      </span>
    </span>
  );
}

/** A single article's factual flag chips + hover "why" (latest column + story rows). */
export function ArticleFlags({
  flags,
  reasons,
}: {
  flags: InfluenceFlag[];
  reasons: string[];
}): React.JSX.Element {
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
          <span className="gk-flag independent">Independent</span>
        )}
      </span>
      <span className="gk-tip-card" role="tooltip">
        {flags.length === 0 ? (
          <>Independent — no sponsored, affiliate, review-copy or opinion signals detected.</>
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

/** The "Latest news" column variant — reads its flags off a LatestArticle. */
export function ArticleBiasTag({ article }: { article: LatestArticle }): React.JSX.Element {
  return <ArticleFlags flags={article.flags} reasons={article.reasons} />;
}
