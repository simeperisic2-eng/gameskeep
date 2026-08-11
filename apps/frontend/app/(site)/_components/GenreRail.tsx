import type { GenreCount } from '@/lib/public-api';

/**
 * "Browse by genre" (BLUEPRINT 3.4 discovery, news-portal feel) — built from the
 * catalog's existing genre data. Each chip deep-links into the filtered,
 * paginated catalog at /games/browse (A1) — a real crawlable URL, no client JS.
 */
export function GenreRail({ genres }: { genres: GenreCount[] }): React.JSX.Element | null {
  if (genres.length === 0) return null;
  return (
    <section className="gk-container gk-section-tight" aria-label="Browse by genre">
      <div className="gk-section-head">
        <div>
          <span className="gk-eyebrow">Find your lane</span>
          <h2 className="gk-section-title">Browse by genre</h2>
        </div>
      </div>
      <div className="gk-genre-rail">
        {genres.map((g) => (
          <a
            key={g.name}
            className="gk-genre-chip"
            href={`/games/browse?genre=${encodeURIComponent(g.name)}`}
          >
            <span className="gk-genre-name">{g.name}</span>
            <span className="gk-genre-count">{g.count}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
