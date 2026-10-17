'use client';

import { useState } from 'react';
import type { HomepageSectionItem, PublicDisplay, TopicCard } from '@/lib/public-api';
import {
  distinctSubtitle,
  publicTopicStatus,
  scoreToTen,
  stripLeadingTitle,
  truncateWords,
} from '@/lib/format';
import { excerptRule, label } from '@/lib/labels';
import { isHttpUrl } from '@/lib/url';
import { DeltaChip } from './DeltaChip';
import { compactTopicToken } from '@/lib/bias';
import { CoverArt } from './CoverArt';
import { BiasBar } from './BiasBar';
import { PaidLabel } from './PaidLabel';
import { TagChips } from './TagChips';
import { AiLabel } from './AiLabel';

/**
 * The homepage HERO (SPEC I5a) — the "wow".
 *
 * A list of trending stories on the left; the selected one enlarges on the
 * right with its cover, an AI summary and the signature BIAS BAR (both axes).
 * Selection is USER-DRIVEN (hover/click) — no auto-timer carousel. Phase P S2:
 * the list ORDER is the Trending section's (pins hold their position — it never
 * rotates); only the initially highlighted story rotates at server render. Each
 * row carries its Δ with the window; the spotlight shows how the story is being
 * covered (up to three outlets' headlines, linking out). Paid inserts (owner
 * decision B — a story or a game) carry the render-forced label and no rank
 * number; organic rows keep their numbering.
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

/**
 * A compact factual-flag token for the dense trending list (no fake scale). The
 * default scope shows only a Sponsored token where one exists — otherwise nothing.
 */
function miniInfluence(t: TopicCard, display: PublicDisplay): React.JSX.Element | null {
  const token = compactTopicToken(t.flags, display.scope, t.integrityTally);
  if (!token) return null;
  return (
    <span className={`gk-trend-flag ${token.kind}`}>
      <i className="gk-trend-dot" aria-hidden />
      {token.label}
    </span>
  );
}

export function Hero({
  items,
  windowHours,
  title = 'Trending now',
  display,
  initial = 0,
}: {
  items: HomepageSectionItem[];
  windowHours: number | null;
  title?: string;
  display: PublicDisplay;
  initial?: number;
}): React.JSX.Element {
  const rows = items.filter((i) => i.topic !== null || i.game !== null);
  const [active, setActive] = useState(Math.min(initial, Math.max(0, rows.length - 1)));
  // Organic rows keep their rank numbers; paid inserts are never numbered.
  let n = 0;
  const ranks = rows.map((r) => (r.paid ? null : (n += 1)));

  if (rows.length === 0) {
    return (
      <div className="gk-spotlight" style={{ padding: 28 }}>
        <p className="gk-section-sub">{label('empty.hero')}</p>
      </div>
    );
  }

  const keyOf = (r: HomepageSectionItem, i: number): string =>
    `${r.paid ? 'paid' : 'org'}:${r.topic?.id ?? r.game?.slug ?? ''}:${i}`;

  return (
    <div className="gk-hero-grid">
      <div className="gk-trending">
        <div className="gk-trending-cap">
          <span className="gk-pulse" aria-hidden />
          {title}
        </div>
        <ul className="gk-trend-list">
          {rows.map((r, i) => {
            const t = r.topic;
            const g = r.game;
            return (
              <li key={keyOf(r, i)}>
                {/* B1: the row is a real LINK (headlines navigate). Hover/focus
                    still drives the spotlight selection — pointing selects,
                    clicking goes. */}
                <a
                  className={`gk-trend-item${i === active ? ' is-active' : ''}${r.paid ? ' is-paid' : ''}`}
                  href={t ? `/topics/${t.slug}` : `/games/${g?.slug ?? ''}`}
                  aria-current={i === active ? 'true' : undefined}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                >
                  <span className="gk-trend-rank">{ranks[i] ?? ''}</span>
                  <span style={{ minWidth: 0 }}>
                    <span className="gk-trend-title">{t ? t.title : (g?.name ?? '')}</span>
                    <span className="gk-trend-meta">
                      {r.paid ? <PaidLabel paid={r.paid} compact /> : null}
                      {t ? (
                        <>
                          {miniInfluence(t, display)}
                          <span>
                            {t.sourceCount > 1 ? `${t.sourceCount} sources` : 'single source'}
                          </span>
                          <span aria-hidden>·</span>
                          <span>
                            {t.articleCount} {t.articleCount === 1 ? 'article' : 'articles'}
                          </span>
                          <DeltaChip delta={r.delta} windowHours={windowHours} />
                        </>
                      ) : (
                        <span>{g?.genres[0] ?? 'Game'}</span>
                      )}
                    </span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="gk-spotlight">
        {rows.map((r, i) => {
          if (!r.topic) {
            // A game row (only a paid insert puts a game into Trending).
            const g = r.game!;
            const critics = scoreToTen(g.critics);
            const community = scoreToTen(g.community);
            return (
              <article
                key={keyOf(r, i)}
                className={`gk-spot-panel${i === active ? ' is-active' : ''}`}
                aria-hidden={i !== active}
              >
                <div className="gk-spot-cover">
                  <CoverArt label={g.name} imageUrl={g.coverUrl} kicker="Game" />
                </div>
                <div className="gk-spot-body">
                  {r.paid ? <PaidLabel paid={r.paid} /> : null}
                  <h3 className="gk-spot-title">
                    <a
                      className="gk-title-link"
                      href={`/games/${g.slug}`}
                      tabIndex={i === active ? undefined : -1}
                    >
                      {g.name}
                    </a>
                  </h3>
                  <TagChips tags={r.tags ?? []} />
                  {critics || community ? (
                    <p className="gk-spot-summary">
                      {critics ? `Critics ${critics}` : ''}
                      {critics && community ? ' · ' : ''}
                      {community ? `Community ${community}` : ''}
                    </p>
                  ) : null}
                  <div className="gk-spot-foot">
                    <span className="gk-section-sub" style={{ margin: 0, fontSize: 13 }}>
                      {g.genres.slice(0, 2).join(' · ')}
                    </span>
                    <a
                      className="gk-readlink"
                      href={`/games/${g.slug}`}
                      tabIndex={i === active ? undefined : -1}
                    >
                      See the game <ArrowRight />
                    </a>
                  </div>
                </div>
              </article>
            );
          }
          const t: TopicCard = r.topic;
          const fromSummary = stripLeadingTitle(t.aiSummary, t.title);
          const summary = truncateWords(
            fromSummary ?? distinctSubtitle(t.title, t.tldr),
            excerptRule('spotlight'),
          );
          // Phase P S5: the AI label goes with automatic AI text only (an editor's
          // TL;DR or an approved summary is editorial).
          const summaryIsAi = fromSummary ? t.summaryIsAi !== false : t.tldrIsAi !== false;
          const coverage = (r.coverage ?? []).filter((c) => c.title);
          const status = publicTopicStatus(t.status);
          return (
            <article
              key={keyOf(r, i)}
              className={`gk-spot-panel${i === active ? ' is-active' : ''}`}
              aria-hidden={i !== active}
            >
              <div className="gk-spot-cover">
                <CoverArt label={t.primaryGame?.name ?? t.title} kicker={t.typeLabel ?? 'Story'} />
              </div>
              <div className="gk-spot-body">
                {r.paid ? <PaidLabel paid={r.paid} /> : null}
                <div className="gk-chips">
                  {t.typeLabel ? <span className="gk-chip amber">{t.typeLabel}</span> : null}
                  {status ? (
                    <span className="gk-chip">
                      <span className="gk-chip-dot" style={{ opacity: 0.7 }} aria-hidden />
                      {status}
                    </span>
                  ) : null}
                  {t.primaryGame ? (
                    <a className="gk-chip gk-chip-link" href={`/games/${t.primaryGame.slug}`}>
                      {t.primaryGame.name}
                    </a>
                  ) : null}
                </div>

                <h3 className="gk-spot-title">
                  <a className="gk-title-link" href={`/topics/${t.slug}`}>
                    {t.title}
                  </a>
                </h3>
                <TagChips tags={r.tags ?? []} />

                {summary ? (
                  <div>
                    {summaryIsAi ? (
                      <AiLabel />
                    ) : (
                      <span className="gk-ai-label">
                        <span className="gk-chip-dot" aria-hidden />
                        Summary
                      </span>
                    )}
                    <p className="gk-spot-summary">{summary}</p>
                  </div>
                ) : null}

                {coverage.length > 0 ? (
                  <div className="gk-spot-coverage">
                    <span className="gk-ai-label">How it’s being covered</span>
                    <ul className="gk-spot-cov-list">
                      {coverage.map((c) => (
                        <li key={c.source} className="gk-spot-cov-row">
                          <span className="gk-spot-cov-src">{c.source}</span>
                          {isHttpUrl(c.url) ? (
                            <a
                              className="gk-spot-cov-title"
                              href={c.url}
                              target="_blank"
                              rel="noopener noreferrer nofollow"
                              tabIndex={i === active ? undefined : -1}
                            >
                              {c.title}
                            </a>
                          ) : (
                            <span className="gk-spot-cov-title">{c.title}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {t.showPanel ? (
                  <BiasBar
                    flags={t.flags}
                    integrity={t.integrityTally}
                    distribution={t.distribution}
                    sourceCount={t.sourceCount}
                  />
                ) : null}

                <div className="gk-spot-foot">
                  <span className="gk-section-sub" style={{ margin: 0, fontSize: 13 }}>
                    {t.sourceCount > 0
                      ? `${t.sourceCount} ${t.sourceCount === 1 ? 'outlet' : 'outlets'} · ${t.articleCount} ${t.articleCount === 1 ? 'article' : 'articles'}`
                      : `${t.articleCount} ${t.articleCount === 1 ? 'article' : 'articles'}`}
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
