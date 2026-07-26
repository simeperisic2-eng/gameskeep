import type { RankedGame } from '@/lib/public-api';
import { scoreToTen } from '@/lib/format';

/**
 * Games in focus (BLUEPRINT 3.1) — recently rated + the controversial ones with
 * a big critic↔community gap. This is where the DISCONNECT differentiator
 * surfaces on the homepage, bridging the news side to the catalog.
 */
const BAND_LABEL: Record<string, string> = {
  agree: 'In agreement',
  mild: 'Mild gap',
  notable: 'Notable gap',
  large: 'Large gap',
};

function Disconnect({ value, band }: { value: number; band: string | null }): React.JSX.Element {
  const key = band ?? 'mild';
  return (
    <span className={`gk-disconnect gk-disc-${key}`}>
      <span className="num">{(value / 10).toFixed(1)}</span>
      {BAND_LABEL[key] ?? 'Gap'}
    </span>
  );
}

function ScoreCol({
  label,
  score,
  amber = false,
}: {
  label: string;
  score: number | null;
  amber?: boolean;
}): React.JSX.Element | null {
  const display = scoreToTen(score);
  if (!display) return null;
  return (
    <div className="gk-scorecol">
      <span className="label">{label}</span>
      <span className={`val${amber ? ' amber' : ''}`}>{display}</span>
    </div>
  );
}

export function GamesInFocus({ games }: { games: RankedGame[] }): React.JSX.Element | null {
  if (games.length === 0) return null;
  return (
    <section className="gk-container gk-section" aria-label="Games in focus">
      <div className="gk-section-head">
        <div>
          <span className="gk-eyebrow">The disconnect</span>
          <h2 className="gk-section-title">Games in focus</h2>
          <p className="gk-section-sub">
            Where critics and players don&apos;t agree — the gap, with context.
          </p>
        </div>
        <a className="gk-readlink" href="/games">
          All ratings →
        </a>
      </div>

      <div className="gk-focus-grid">
        {games.map((g) => (
          <a key={g.slug} className="gk-gamecard" href={`/games/${g.slug}`}>
            <h3 className="gk-gamecard-name">{g.name}</h3>
            <div className="gk-scores">
              <ScoreCol label="Critics" score={g.critics} />
              <ScoreCol label="Community" score={g.community} />
              <ScoreCol label="Our" score={g.our} amber />
            </div>
            {g.disconnectValue != null ? (
              <Disconnect value={g.disconnectValue} band={g.disconnectBand} />
            ) : null}
          </a>
        ))}
      </div>
    </section>
  );
}
