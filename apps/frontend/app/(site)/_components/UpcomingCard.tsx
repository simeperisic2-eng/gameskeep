import type { UpcomingEntry, UpcomingGame } from '@/lib/public-api';
import { CoverArt } from './CoverArt';
import { HypeButton } from './HypeButton';

/**
 * Upcoming game card (SPEC I5b; BLUEPRINT 2.4; Upcoming enrichment) — status +
 * release date + a live countdown + the HYPE placeholder. Enrichment (optional):
 * a PAID `promoted` carries the render-forced "Promoted · advertiser" label (as
 * prominent as a bias flag — transparency is not relaxed for revenue); an
 * `isIndie` shows an "Indie" chip; an editorial `featured` gets a subtle accent
 * frame + a NEUTRAL "Editor's pick" marker (our free curatorial choice — NOT a
 * paid label). The countdown is computed server-side at render (force-dynamic).
 */
type CardGame = UpcomingGame & Partial<Pick<UpcomingEntry, 'isIndie' | 'featured' | 'promoted'>>;
const STATUS_LABEL: Record<string, string> = {
  announced: 'Announced',
  in_development: 'In development',
  early_access: 'Early access',
};

function formatDate(iso: string | null): string {
  if (!iso) return 'Date TBA';
  const d = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Whole days from today (UTC) to the release date; null when undated. */
function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return null;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((d.getTime() - today) / 86_400_000);
}

function countdown(days: number | null): { value: string; unit: string } {
  if (days == null) return { value: 'TBA', unit: '' };
  if (days <= 0) return { value: 'Out', unit: 'now' };
  if (days === 1) return { value: '1', unit: 'day' };
  if (days < 60) return { value: String(days), unit: 'days' };
  return { value: String(Math.round(days / 30)), unit: 'months' };
}

export function UpcomingCard({ game }: { game: CardGame }): React.JSX.Element {
  const days = daysUntil(game.releaseDate);
  const cd = countdown(days);
  const statusLabel = STATUS_LABEL[game.status] ?? game.status;
  const maker = game.developer ?? game.publisher;
  const promoted = game.promoted ?? null;
  const featured = Boolean(game.featured);

  return (
    <article
      className={`gk-upcard${promoted ? ' is-promoted' : ''}${featured && !promoted ? ' is-featured' : ''}`}
    >
      {/* PAID promotion — the render-forced label (never a toggleable field). */}
      {promoted ? (
        <div className="gk-upcard-promoted" aria-label="Promoted content">
          <span className="gk-slot-flag">Promoted</span>
          <span className="gk-upcard-promoted-by">Paid promotion · {promoted.advertiser}</span>
        </div>
      ) : featured ? (
        <div className="gk-upcard-featured" aria-label="Editor's pick">
          Editor’s pick
        </div>
      ) : null}
      <a className="gk-upcard-cover" href={`/games/${game.slug}`}>
        <CoverArt label={game.name} imageUrl={game.coverUrl} variant="thumb" />
      </a>
      <div className="gk-upcard-body">
        <div className="gk-upcard-top">
          <span className={`gk-status gk-status-game-${game.status}`}>{statusLabel}</span>
          {game.isIndie ? <span className="gk-chip gk-chip-indie">Indie</span> : null}
          {game.series ? <span className="gk-chip">{game.series}</span> : null}
        </div>

        <h3 className="gk-upcard-name">
          <a href={`/games/${game.slug}`}>{game.name}</a>
        </h3>
        {maker ? <p className="gk-upcard-maker">{maker}</p> : null}
        {game.summary ? <p className="gk-upcard-summary">{game.summary}</p> : null}

        {game.genres.length > 0 || game.platforms.length > 0 ? (
          <div className="gk-upcard-taxos">
            {/* B1: taxonomy chips deep-link into the filtered catalog (A1 URLs). */}
            {game.genres.slice(0, 2).map((g) => (
              <a
                key={`g-${g}`}
                className="gk-chip gk-chip-link"
                href={`/games/browse?genre=${encodeURIComponent(g)}`}
              >
                {g}
              </a>
            ))}
            {game.platforms.slice(0, 3).map((p) => (
              <a
                key={`p-${p}`}
                className="gk-chip ghost gk-chip-link"
                href={`/games/browse?platform=${encodeURIComponent(p)}`}
              >
                {p}
              </a>
            ))}
          </div>
        ) : null}

        <div className="gk-upcard-foot">
          <div className="gk-upcard-release">
            <span className="gk-upcard-date">{formatDate(game.releaseDate)}</span>
            <span className="gk-upcard-when">
              {game.status === 'early_access' && game.releaseDate ? '1.0 expected' : 'Release'}
            </span>
          </div>
          <div className="gk-countdown" aria-label="Countdown to release">
            <span className="gk-countdown-num">{cd.value}</span>
            {cd.unit ? <span className="gk-countdown-unit">{cd.unit}</span> : null}
          </div>
        </div>

        {/* HYPE — live community vote (I6). */}
        <div className="gk-hype" aria-label="Community hype">
          <HypeButton gameId={game.id} />
        </div>
      </div>
    </article>
  );
}
