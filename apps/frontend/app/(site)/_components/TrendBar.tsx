import type { TopicCard } from '@/lib/public-api';

/**
 * Trending quick-access strip (Ground-News style) — a row of trending
 * topic/game chips directly under the header. NOT sticky (the header is; this
 * scrolls away normally). Each chip links to its story. The "+" follow
 * affordance is I6 (accounts) — chips only for now.
 */
function chipLabel(t: TopicCard): string {
  if (t.primaryGame) return t.primaryGame.name;
  // No game tag → a short slice of the title up to the first natural break.
  const title = t.title.split(/[:–—-]/)[0]!.trim();
  return title.length > 26 ? `${title.slice(0, 26).trimEnd()}…` : title;
}

export function TrendBar({ topics }: { topics: TopicCard[] }): React.JSX.Element | null {
  if (topics.length === 0) return null;
  // De-dupe by label so the same game doesn't repeat across stories.
  const seen = new Set<string>();
  const chips = topics.filter((t) => {
    const label = chipLabel(t);
    if (seen.has(label)) return false;
    seen.add(label);
    return true;
  });

  return (
    <nav className="gk-trendbar" aria-label="Trending topics">
      <div className="gk-container gk-trendbar-inner">
        <span className="gk-trendbar-cap" aria-hidden>
          <span className="gk-pulse" />
          Trending
        </span>
        <ul className="gk-trendbar-list">
          {chips.map((t) => (
            <li key={t.id}>
              <a className="gk-trendchip" href={`/topics/${t.slug}`}>
                {chipLabel(t)}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
