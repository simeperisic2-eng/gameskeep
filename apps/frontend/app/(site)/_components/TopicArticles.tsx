'use client';

import { useMemo, useState } from 'react';
import type { PublicDisplay, TopicArticleRow } from '@/lib/public-api';
import { relativeTime, truncateWords } from '@/lib/format';
import { NO_SIGNALS_LABEL } from '@/lib/bias';
import { ArticleFlags } from './BiasBar';
import { NoSignalsNote, ReviewSignals } from './IntegrityBlock';
import { SourceIcon } from './SourceIcon';

/**
 * Every source's coverage of a story (BLUEPRINT 3.3), each row = one outlet:
 * attribution monogram + name, title, excerpt (excerpt + link only — the I1
 * copyright posture; we never reproduce full text), the row's signals, date, and
 * a link OUT to the original. Author shows only on our own articles.
 *
 * Phase P S1: what a row shows is decided server-side (`biasMode`) — reviews and
 * sponsored rows get the full panel (reviews also the integrity block), other
 * news shows nothing under the default scope. Filters + sort only ever use PUBLIC
 * signals (never a score that carries the engine's review-copy inference).
 *
 * Sort + filter run CLIENT-side over rows that are ALL present in the SSR HTML
 * (filtered rows are hidden, not removed) so the page stays fully crawlable.
 */
type SortKey = 'date' | 'source' | 'signals';
type FilterKey = 'all' | 'sponsored' | 'reviews' | 'nosignal' | 'quality';

const QUALITY_MIDPOINT = 50;

function signalCount(a: TopicArticleRow): number {
  return a.flags.length + (a.integrity?.length ?? 0);
}

function sortRows(rows: TopicArticleRow[], key: SortKey): TopicArticleRow[] {
  const copy = [...rows];
  if (key === 'source') {
    copy.sort((a, b) => (a.sourceName ?? '~').localeCompare(b.sourceName ?? '~'));
  } else if (key === 'signals') {
    // Fewest public signals first (facts only — never an influence score).
    copy.sort((a, b) => signalCount(a) - signalCount(b));
  } else {
    copy.sort(
      (a, b) => new Date(b.publishDate ?? 0).getTime() - new Date(a.publishDate ?? 0).getTime(),
    );
  }
  return copy;
}

function matches(a: TopicArticleRow, filter: FilterKey): boolean {
  if (filter === 'sponsored') return a.flags.includes('sponsored');
  if (filter === 'reviews') return a.isReview;
  if (filter === 'nosignal') return a.biasMode === 'panel' && signalCount(a) === 0;
  if (filter === 'quality') return a.quality != null && a.quality >= QUALITY_MIDPOINT;
  return true;
}

function filtersFor(display: PublicDisplay): { key: FilterKey; label: string }[] {
  const out: { key: FilterKey; label: string }[] = [
    { key: 'all', label: 'All coverage' },
    { key: 'sponsored', label: 'Sponsored only' },
    { key: 'reviews', label: 'Reviews only' },
  ];
  if (display.scope === 'all') out.push({ key: 'nosignal', label: `${NO_SIGNALS_LABEL} only` });
  if (display.showQuality) out.push({ key: 'quality', label: 'Top quality only' });
  return out;
}

function sortsFor(display: PublicDisplay): { key: SortKey; label: string }[] {
  const out: { key: SortKey; label: string }[] = [
    { key: 'date', label: 'Newest first' },
    { key: 'source', label: 'By source' },
  ];
  if (display.scope === 'all') out.push({ key: 'signals', label: 'By signals' });
  return out;
}

function ArticleRow({ a }: { a: TopicArticleRow }): React.JSX.Element {
  const source = a.sourceName ?? (a.origin === 'ours' ? 'GamesKeep' : 'Source');
  const time = relativeTime(a.publishDate);
  const excerpt = truncateWords(a.excerpt, 240);
  return (
    <article className="gk-srcrow">
      <SourceIcon name={source} />
      <div className="gk-srcrow-body">
        <div className="gk-srcrow-top">
          <span className="gk-srcrow-source">{source}</span>
          <span className="gk-srcrow-type">{a.articleType}</span>
        </div>
        {/* B1: the headline itself links out to the original (same target as
            "Read at" — excerpt + link only, the I1 copyright posture). */}
        <h3 className="gk-srcrow-title">
          {a.url ? (
            <a
              className="gk-title-link"
              href={a.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
            >
              {a.title}
            </a>
          ) : (
            a.title
          )}
        </h3>
        {excerpt ? <p className="gk-srcrow-excerpt">{excerpt}</p> : null}
        {a.isReview && a.biasMode === 'panel' ? <ReviewSignals row={a} /> : null}
        <div className="gk-srcrow-foot">
          {a.isReview ? null : (
            <ArticleFlags flags={a.flags} reasons={a.reasons} mode={a.biasMode} />
          )}
          <span className="gk-srcrow-meta">
            {a.author ? `By ${a.author} · ` : ''}
            {time ?? ''}
          </span>
          {a.url ? (
            <a
              className="gk-readlink"
              href={a.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
            >
              Read at {source} ↗
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function TopicArticles({
  articles,
  display,
}: {
  articles: TopicArticleRow[];
  display: PublicDisplay;
}): React.JSX.Element {
  const [sort, setSort] = useState<SortKey>('date');
  const [filter, setFilter] = useState<FilterKey>('all');
  const filters = filtersFor(display);
  const sorts = sortsFor(display);

  const ordered = useMemo(() => sortRows(articles, sort), [articles, sort]);
  const visibleCount = useMemo(
    () => articles.filter((a) => matches(a, filter)).length,
    [articles, filter],
  );

  // Phase P S2: paid placements never sit between outlet articles — they appear
  // only in discovery sections and sidebar slots.

  return (
    <section className="gk-coverage" aria-label="All coverage">
      <div className="gk-coverage-head">
        <h2 className="gk-section-title">
          All coverage <span className="gk-coverage-count">{visibleCount}</span>
        </h2>
        <div className="gk-coverage-controls">
          <div className="gk-filterchips" role="group" aria-label="Filter coverage">
            {filters.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`gk-filterchip${filter === f.key ? ' is-active' : ''}`}
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <label className="gk-sort">
            <span>Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              {sorts.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {visibleCount === 0 ? (
        <p className="gk-section-sub">No coverage matches this filter.</p>
      ) : null}

      <div className="gk-srcrows">
        {ordered.map((a) => (
          <div key={a.id} hidden={!matches(a, filter)}>
            <ArticleRow a={a} />
          </div>
        ))}
      </div>
      <NoSignalsNote rows={articles} />
    </section>
  );
}
