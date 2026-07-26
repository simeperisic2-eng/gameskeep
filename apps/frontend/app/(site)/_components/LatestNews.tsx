import type { LatestArticle } from '@/lib/public-api';
import { relativeTime, truncateWords } from '@/lib/format';
import { ArticleBiasTag } from './BiasBar';

/**
 * "Latest news" column (BLUEPRINT 3.1) — newest articles, newest on top. It
 * UPDATES (newest first) but NEVER auto-scrolls (self-scroll fights reading). On
 * mobile the whole sidebar stacks below the main feed (see site.css .gk-portal).
 * Small cards stay clean + typographic (no image) — Ground-News "Top News" style.
 *
 * Aggregation posture: excerpt + link only — each row links OUT to the original
 * source (copyright + fair-use). The bias tag carries a hover "why".
 */
export function LatestNews({ articles }: { articles: LatestArticle[] }): React.JSX.Element {
  return (
    <section className="gk-panel" aria-label="Latest news">
      <div className="gk-panel-head">
        <h2 className="gk-panel-title">Latest</h2>
        <span className="gk-live">
          <span className="gk-pulse" aria-hidden />
          Live feed
        </span>
      </div>

      {articles.length === 0 ? (
        <p className="gk-section-sub">No articles yet.</p>
      ) : (
        <div>
          {articles.map((a) => {
            const time = relativeTime(a.publishDate);
            const isExternal = a.origin === 'aggregated' && a.url;
            const inner = (
              <>
                <div className="gk-artrow-top">
                  <span className="gk-source">
                    <span className="gk-source-dot" aria-hidden />
                    {a.sourceName ?? (a.origin === 'ours' ? 'GamesKeep' : 'Source')}
                  </span>
                </div>
                <h3 className="gk-artrow-title">{a.title}</h3>
                {a.excerpt ? (
                  <p className="gk-topiccard-tldr" style={{ marginTop: 6 }}>
                    {truncateWords(a.excerpt, 110)}
                  </p>
                ) : null}
                <div className="gk-artrow-foot">
                  <ArticleBiasTag article={a} />
                  {time ? <span>{time}</span> : null}
                </div>
              </>
            );
            return isExternal ? (
              <a
                key={a.id}
                className="gk-artrow"
                href={a.url ?? '#'}
                target="_blank"
                rel="noopener noreferrer nofollow"
              >
                {inner}
              </a>
            ) : (
              <div key={a.id} className="gk-artrow">
                {inner}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
