import type { CatalogGame } from '@/lib/public-api';
import { scoreToTen } from '@/lib/format';
import { CoverArt } from './CoverArt';

/**
 * A catalog tile (SPEC I5b; BLUEPRINT 2.4) — the IMDb-style browse card. Leads
 * with the designed cover, then the SEPARATED scores (Critics / Our / Community,
 * never merged into one number) and a disconnect band chip ONLY where the gap is
 * real (notable/large) — the one signal worth surfacing at a glance. Red is used
 * only for a large gap (the brand rule); everything else stays calm.
 */
const STATUS_LABEL: Record<string, string> = {
  announced: 'Announced',
  in_development: 'In development',
  early_access: 'Early access',
  released: 'Released',
  delisted: 'Delisted',
};

const BAND_LABEL: Record<string, string> = {
  agree: 'Aligned',
  mild: 'Mild gap',
  notable: 'Notable gap',
  large: 'Large gap',
};

function TileScore({
  label,
  score,
  amber = false,
}: {
  label: string;
  score: number | null;
  amber?: boolean;
}): React.JSX.Element {
  const display = scoreToTen(score);
  return (
    <div className="gk-tile-score">
      <span className="gk-tile-score-label">{label}</span>
      <span className={`gk-tile-score-val${amber ? ' amber' : ''}${display ? '' : ' none'}`}>
        {display ?? '—'}
      </span>
    </div>
  );
}

export function GameTile({
  game,
  note,
}: {
  game: CatalogGame;
  /** Optional factual context line (A1 discovery — e.g. "12 articles · 6 outlets"). */
  note?: string;
}): React.JSX.Element {
  const statusLabel = STATUS_LABEL[game.status] ?? game.status;
  // Only surface the gap chip when it actually signals disagreement.
  const showBand =
    game.disconnectValue != null &&
    (game.disconnectBand === 'notable' || game.disconnectBand === 'large');
  return (
    /* B1 structure: a plain CONTAINER — cover + name are the game links, the
     * genre chips are SIBLING links into the filtered catalog. Never nested
     * anchors (max depth = 1). */
    <article className="gk-tile">
      <a className="gk-tile-cover" href={`/games/${game.slug}`} tabIndex={-1} aria-hidden>
        <CoverArt label={game.name} imageUrl={game.coverUrl} variant="thumb" />
        {/* "Released" is the default — only label the states that stand out. */}
        {game.status !== 'released' ? (
          <span className={`gk-tile-status gk-status-game-${game.status}`}>{statusLabel}</span>
        ) : null}
        {showBand ? (
          <span className={`gk-tile-band gk-gd-${game.disconnectBand}`}>
            <span className="gk-tile-band-dot" aria-hidden />
            {BAND_LABEL[game.disconnectBand ?? 'mild']}
          </span>
        ) : null}
      </a>
      <div className="gk-tile-body">
        <h3 className="gk-tile-name">
          <a className="gk-title-link" href={`/games/${game.slug}`}>
            {game.name}
          </a>
        </h3>
        {game.genres.length > 0 ? (
          <p className="gk-tile-genres">
            {game.genres.slice(0, 3).map((g, i) => (
              <span key={g}>
                {i > 0 ? ' · ' : ''}
                <a
                  className="gk-tile-genre-link"
                  href={`/games/browse?genre=${encodeURIComponent(g)}`}
                >
                  {g}
                </a>
              </span>
            ))}
          </p>
        ) : (
          <p className="gk-tile-genres gk-tile-genres-empty">Catalog entry</p>
        )}
        <div className="gk-tile-scores">
          <TileScore label="Critics" score={game.critics} />
          <TileScore label="Our" score={game.our} amber />
          <TileScore label="Players" score={game.community} />
        </div>
        {note ? <p className="gk-tile-note">{note}</p> : null}
      </div>
    </article>
  );
}
