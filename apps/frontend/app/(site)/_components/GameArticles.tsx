import type { GameArticleRow } from '@/lib/public-api';
import { categoryChip, relativeTime, truncateWords } from '@/lib/format';
import { brand, excerptRule } from '@/lib/labels';
import { ArticleFlags } from './BiasBar';
import { NoSignalsNote, ReviewSignals } from './IntegrityBlock';
import { SourceIcon } from './SourceIcon';

/**
 * Coverage that mentions this game (BLUEPRINT 2.3) — excerpt + link only, the same
 * copyright posture as the story page (we never reproduce full text, we link OUT
 * with clear attribution). Author shows only on our own articles.
 *
 * Phase P S1: outlet REVIEWS sit in their own block pinned above the news, each
 * with its signals panel + the review-integrity block; the news list below shows
 * signals only where the display scope allows (decided server-side per row).
 */
function Row({ a }: { a: GameArticleRow }): React.JSX.Element {
  const source = a.sourceName ?? (a.origin === 'ours' ? brand() : 'Source');
  const time = relativeTime(a.publishDate);
  const excerpt = truncateWords(a.excerpt, excerptRule('gameArticle'));
  return (
    <article className="gk-srcrow">
      <SourceIcon name={source} />
      <div className="gk-srcrow-body">
        <div className="gk-srcrow-top">
          <span className="gk-srcrow-source">{source}</span>
          <span className="gk-srcrow-type">{a.articleType}</span>
          {categoryChip(a.category, a.articleType) ? (
            <span className="gk-chip gk-chip-category">
              {categoryChip(a.category, a.articleType)}
            </span>
          ) : null}
          {a.origin === 'ours' ? <span className="gk-chip amber">Ours</span> : null}
        </div>
        {/* B1: the headline links out to the original (same target as "Read at"). */}
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

export function GameArticles({
  articles,
  variant = 'news',
}: {
  articles: GameArticleRow[];
  variant?: 'news' | 'reviews';
}): React.JSX.Element | null {
  if (articles.length === 0) return null;
  const reviews = variant === 'reviews';
  return (
    <section
      className={`gk-coverage${reviews ? ' gk-coverage-reviews' : ''}`}
      aria-label={reviews ? 'Reviews' : 'In the news'}
    >
      <div className="gk-coverage-head">
        <h2 className="gk-section-title">
          {reviews ? 'Reviews' : 'In the news'}{' '}
          <span className="gk-coverage-count">{articles.length}</span>
        </h2>
        <p className="gk-section-sub" style={{ margin: 0 }}>
          {reviews
            ? 'Outlet reviews of this game — with how each review was produced, where we found it.'
            : 'Other coverage that mentions this game.'}
        </p>
      </div>
      <div className="gk-srcrows">
        {articles.map((a) => (
          <Row key={a.id} a={a} />
        ))}
      </div>
      <NoSignalsNote rows={articles} />
    </section>
  );
}
