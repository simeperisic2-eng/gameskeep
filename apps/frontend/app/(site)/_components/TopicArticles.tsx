'use client';

import { Fragment, useMemo, useState } from 'react';
import type { TopicArticleRow } from '@/lib/public-api';
import { relativeTime, truncateWords } from '@/lib/format';
import { ArticleFlags } from './BiasBar';
import { SourceIcon } from './SourceIcon';

/**
 * Every source's coverage of a story (BLUEPRINT 3.3), each row = one outlet:
 * attribution monogram + name, title, excerpt (excerpt + link only — the I1
 * copyright posture; we never reproduce full text), the per-article factual
 * influence flags, date, and a link OUT to the original. Author shows only on our
 * own articles (the backend nulls it for aggregated — the reader sees the byline
 * on the source).
 *
 * Sort + filter run CLIENT-side over rows that are ALL present in the SSR HTML
 * (filtered rows are hidden, not removed) so the page stays fully crawlable — the
 * controls reorder/reveal existing content, they never fetch it.
 */
type SortKey = 'date' | 'source' | 'influence';
type FilterKey = 'all' | 'independent' | 'sponsored' | 'quality';

const SORT_LABEL: Record<SortKey, string> = {
  date: 'Newest first',
  source: 'By source',
  influence: 'By influence',
};
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All coverage' },
  { key: 'independent', label: 'Independent only' },
  { key: 'sponsored', label: 'Sponsored only' },
  { key: 'quality', label: 'Top quality only' },
];

const QUALITY_MIDPOINT = 50;

function sortRows(rows: TopicArticleRow[], key: SortKey): TopicArticleRow[] {
  const copy = [...rows];
  if (key === 'source') {
    copy.sort((a, b) => (a.sourceName ?? '~').localeCompare(b.sourceName ?? '~'));
  } else if (key === 'influence') {
    // Most independent first: fewer flags, then lower influence score.
    copy.sort((a, b) => a.flags.length - b.flags.length || (a.influence ?? 0) - (b.influence ?? 0));
  } else {
    copy.sort(
      (a, b) => new Date(b.publishDate ?? 0).getTime() - new Date(a.publishDate ?? 0).getTime(),
    );
  }
  return copy;
}

function matches(a: TopicArticleRow, filter: FilterKey): boolean {
  if (filter === 'independent') return a.flags.length === 0;
  if (filter === 'sponsored') return a.flags.includes('sponsored');
  if (filter === 'quality') return a.quality != null && a.quality >= QUALITY_MIDPOINT;
  return true;
}

function ArticleRow({ a }: { a: TopicArticleRow }): React.JSX.Element {
  const source = a.sourceName ?? (a.origin === 'ours' ? 'GamesKeep' : 'Source');
  const time = relativeTime(a.publishDate);
  const excerpt = truncateWords(a.excerpt, 240);
  return (
    <article className={`gk-srcrow${a.isPrimary ? ' is-primary' : ''}`}>
      <SourceIcon name={source} />
      <div className="gk-srcrow-body">
        <div className="gk-srcrow-top">
          <span className="gk-srcrow-source">{source}</span>
          <span className="gk-srcrow-type">{a.articleType}</span>
          {a.isPrimary ? <span className="gk-chip amber">Lead source</span> : null}
        </div>
        <h3 className="gk-srcrow-title">{a.title}</h3>
        {excerpt ? <p className="gk-srcrow-excerpt">{excerpt}</p> : null}
        <div className="gk-srcrow-foot">
          <ArticleFlags flags={a.flags} reasons={a.reasons} />
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

/** A native-format promoted slot (BLUEPRINT global rule), clearly labeled "AD". */
function PromotedRow(): React.JSX.Element {
  return (
    <article className="gk-srcrow gk-srcrow-ad" aria-label="Promoted">
      <span className="gk-srcicon gk-srcicon-ad" aria-hidden>
        AD
      </span>
      <div className="gk-srcrow-body">
        <div className="gk-srcrow-top">
          <span className="gk-srcrow-source">Promoted</span>
          <span className="gk-slot-tag">AD</span>
        </div>
        <h3 className="gk-srcrow-title">Promoted slot — unsold</h3>
        <p className="gk-srcrow-excerpt">
          A sold promotion renders here in the same format as a coverage row, always labeled.
        </p>
      </div>
    </article>
  );
}

export function TopicArticles({ articles }: { articles: TopicArticleRow[] }): React.JSX.Element {
  const [sort, setSort] = useState<SortKey>('date');
  const [filter, setFilter] = useState<FilterKey>('all');

  const ordered = useMemo(() => sortRows(articles, sort), [articles, sort]);
  const visibleCount = useMemo(
    () => articles.filter((a) => matches(a, filter)).length,
    [articles, filter],
  );

  // Inject the promoted row after the 3rd item (or at the end for short lists).
  const adAt = Math.min(3, ordered.length);

  return (
    <section className="gk-coverage" aria-label="All coverage">
      <div className="gk-coverage-head">
        <h2 className="gk-section-title">
          All coverage <span className="gk-coverage-count">{visibleCount}</span>
        </h2>
        <div className="gk-coverage-controls">
          <div className="gk-filterchips" role="group" aria-label="Filter coverage">
            {FILTERS.map((f) => (
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
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABEL[k]}
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
        {ordered.map((a, i) => (
          <Fragment key={a.id}>
            {i === adAt ? <PromotedRow /> : null}
            <div hidden={!matches(a, filter)}>
              <ArticleRow a={a} />
            </div>
          </Fragment>
        ))}
        {adAt >= ordered.length ? <PromotedRow /> : null}
      </div>
    </section>
  );
}
