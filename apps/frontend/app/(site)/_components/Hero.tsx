'use client';

import { useState } from 'react';
import type { TopicCard } from '@/lib/public-api';
import { truncateWords } from '@/lib/format';
import { topicFlagSummary } from '@/lib/bias';
import { CoverArt } from './CoverArt';
import { BiasBar } from './BiasBar';

/**
 * The homepage HERO (SPEC I5a) — the "wow".
 *
 * A list of trending stories on the left; the selected one enlarges on the
 * right with its cover, an AI summary and the signature BIAS BAR (both axes).
 * Selection is USER-DRIVEN (hover/click) — no auto-timer carousel. Ordering +
 * initial highlight are decided at SERVER render (refresh-rotation, see page).
 *
 * All trending rows show at once (the list fills the column to the spotlight's
 * height); every spotlight panel is rendered into the DOM at SSR (toggled by
 * class) so `view-source` shows all stories — crawlable, not a JS shell. The
 * client only toggles which panel is active.
 */
function ArrowRight(): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12h14M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A compact factual-flag token for the dense trending list (no fake scale). */
function miniInfluence(t: TopicCard): React.JSX.Element {
  const summary = topicFlagSummary(t.flags);
  return (
    <span className={`gk-trend-flag ${summary.kind}`}>
      <i className="gk-trend-dot" aria-hidden />
      {summary.label}
    </span>
  );
}

export function Hero({
  topics,
  initial = 0,
}: {
  topics: TopicCard[];
  initial?: number;
}): React.JSX.Element {
  const [active, setActive] = useState(Math.min(initial, Math.max(0, topics.length - 1)));

  if (topics.length === 0) {
    return (
      <div className="gk-spotlight" style={{ padding: 28 }}>
        <p className="gk-section-sub">
          Stories are being clustered from the feed — check back in a moment.
        </p>
      </div>
    );
  }

  return (
    <div className="gk-hero-grid">
      <div className="gk-trending">
        <div className="gk-trending-cap">
          <span className="gk-pulse" aria-hidden />
          Trending now
        </div>
        <ul className="gk-trend-list">
          {topics.map((t, i) => (
            <li key={t.id}>
              <button
                type="button"
                className={`gk-trend-item${i === active ? ' is-active' : ''}`}
                aria-pressed={i === active}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onClick={() => setActive(i)}
              >
                <span className="gk-trend-rank">{i + 1}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="gk-trend-title">{t.title}</span>
                  <span className="gk-trend-meta">
                    {miniInfluence(t)}
                    <span>{t.sourceCount > 0 ? `${t.sourceCount} sources` : 'single source'}</span>
                    <span aria-hidden>·</span>
                    <span>
                      {t.articleCount} {t.articleCount === 1 ? 'article' : 'articles'}
                    </span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="gk-spotlight">
        {topics.map((t, i) => {
          const summary = truncateWords(t.aiSummary ?? t.tldr, 220);
          return (
            <article
              key={t.id}
              className={`gk-spot-panel${i === active ? ' is-active' : ''}`}
              aria-hidden={i !== active}
            >
              <div className="gk-spot-cover">
                <CoverArt label={t.primaryGame?.name ?? t.title} kicker={t.typeLabel ?? 'Story'} />
              </div>
              <div className="gk-spot-body">
                <div className="gk-chips">
                  {t.typeLabel ? <span className="gk-chip amber">{t.typeLabel}</span> : null}
                  <span className="gk-chip">
                    <span className="gk-chip-dot" style={{ opacity: 0.7 }} aria-hidden />
                    {t.status}
                  </span>
                  {t.primaryGame ? <span className="gk-chip">{t.primaryGame.name}</span> : null}
                </div>

                <h3 className="gk-spot-title">{t.title}</h3>

                {summary ? (
                  <div>
                    <span className="gk-ai-label">
                      <span className="gk-chip-dot" aria-hidden />
                      AI summary
                    </span>
                    <p className="gk-spot-summary">{summary}</p>
                  </div>
                ) : null}

                <BiasBar
                  flags={t.flags}
                  distribution={t.distribution}
                  sourceCount={t.sourceCount}
                />

                <div className="gk-spot-foot">
                  <span className="gk-section-sub" style={{ margin: 0, fontSize: 13 }}>
                    {t.sourceCount > 0
                      ? `${t.sourceCount} ${t.sourceCount === 1 ? 'outlet' : 'outlets'} · ${t.articleCount} articles`
                      : `${t.articleCount} articles`}
                  </span>
                  <a className="gk-readlink" href={`/topics/${t.slug}`}>
                    See the full story <ArrowRight />
                  </a>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
