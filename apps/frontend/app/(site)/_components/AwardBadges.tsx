import type { GameAwardWin } from '@/lib/public-api';

/**
 * Award-winner badges on a game page (SPEC I7, BLUEPRINT 2.7 "legacy"). Shown
 * only for decided, published editions (the backend already filters to
 * reveal/archive), so a badge never appears for a draft. Each links to that
 * year's winners. Critics' Choice and Community Choice are labelled distinctly.
 */
export function AwardBadges({ wins }: { wins: GameAwardWin[] }): React.JSX.Element | null {
  if (wins.length === 0) return null;
  return (
    <div className="gk-aw-badges">
      {wins.map((w) => (
        <a
          key={`${w.year}-${w.categoryLabel}-${w.outcomeType}`}
          className={`gk-aw-badge is-${w.outcomeType}`}
          href={`/awards/${w.year}`}
        >
          <span className="gk-aw-badge-trophy" aria-hidden="true">
            🏆
          </span>
          <span className="gk-aw-badge-text">
            <b>
              {w.categoryLabel} · {w.year}
            </b>
            <span>{w.outcomeType === 'community' ? 'Community Choice' : 'Critics’ Choice'}</span>
          </span>
        </a>
      ))}
    </div>
  );
}
