import type { GameArticleRow } from '@/lib/public-api';
import { relativeTime, truncateWords } from '@/lib/format';
import { ArticleFlags } from './BiasBar';
import { SourceIcon } from './SourceIcon';

/**
 * Articles that mention this game (BLUEPRINT 2.3) — excerpt + link only, the same
 * copyright posture as the story page (we never reproduce full text, we link OUT
 * with clear attribution). Each row carries the per-article factual influence
 * flags so the bias lens follows the game, not just the story. Author shows only
 * on our own articles (the backend nulls it for aggregated coverage).
 */
function Row({ a }: { a: GameArticleRow }): React.JSX.Element {
  const source = a.sourceName ?? (a.origin === 'ours' ? 'GamesKeep' : 'Source');
  const time = relativeTime(a.publishDate);
  const excerpt = truncateWords(a.excerpt, 220);
  return (
    <article className="gk-srcrow">
      <SourceIcon name={source} />
      <div className="gk-srcrow-body">
        <div className="gk-srcrow-top">
          <span className="gk-srcrow-source">{source}</span>
          <span className="gk-srcrow-type">{a.articleType}</span>
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

export function GameArticles({
  articles,
}: {
  articles: GameArticleRow[];
}): React.JSX.Element | null {
  if (articles.length === 0) return null;
  return (
    <section className="gk-coverage" aria-label="In the news">
      <div className="gk-coverage-head">
        <h2 className="gk-section-title">
          In the news <span className="gk-coverage-count">{articles.length}</span>
        </h2>
        <p className="gk-section-sub" style={{ margin: 0 }}>
          Coverage that mentions this game — with its influence flags.
        </p>
      </div>
      <div className="gk-srcrows">
        {articles.map((a) => (
          <Row key={a.id} a={a} />
        ))}
      </div>
    </section>
  );
}
