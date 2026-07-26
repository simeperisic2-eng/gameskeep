import type { RelatedGame } from '@/lib/public-api';
import { scoreToTen } from '@/lib/format';

/**
 * Related games (BLUEPRINT 2.3) — same series/genre discovery. A compact list in
 * the aside; each links to its own hub. A headline score shows where one exists
 * (critics, else our) — never a fabricated number.
 */
export function RelatedGames({ games }: { games: RelatedGame[] }): React.JSX.Element | null {
  if (games.length === 0) return null;
  return (
    <section className="gk-panel" aria-label="Related games">
      <div className="gk-panel-head">
        <h2 className="gk-panel-title">Related games</h2>
      </div>
      <ul className="gk-relgames">
        {games.map((g) => {
          const score = scoreToTen(g.critics ?? g.our ?? g.community);
          return (
            <li key={g.slug}>
              <a href={`/games/${g.slug}`}>
                <span className="gk-relgame-main">
                  <span className="gk-relgame-name">{g.name}</span>
                  {g.genres.length > 0 ? (
                    <span className="gk-relgame-genre">{g.genres.slice(0, 2).join(' · ')}</span>
                  ) : null}
                </span>
                {score ? <span className="gk-relgame-score">{score}</span> : null}
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
