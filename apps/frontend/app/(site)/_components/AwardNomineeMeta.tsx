import type { AwardNominee } from '@/lib/public-api';

/**
 * The "our better analytics" hook shown under each nominee (SPEC I7, BLUEPRINT
 * 2.7): the three SEPARATED rating layers + the disconnect. Pure/presentational
 * so it renders identically in the SSR results view and inside the client ballot.
 * Only shows the layers that actually have a score (never a fabricated number).
 */
export function AwardNomineeMeta({ nominee }: { nominee: AwardNominee }): React.JSX.Element | null {
  const s = nominee.scores;
  const hasScores = s && (s.critics != null || s.our != null || s.community != null);
  if (!hasScores && !nominee.disconnect) return null;
  return (
    <div className="gk-aw-scores">
      {s?.critics != null ? (
        <span className="gk-aw-score">
          <b>{s.critics}</b> Critics
        </span>
      ) : null}
      {s?.our != null ? (
        <span className="gk-aw-score">
          <b>{s.our}</b> GamesKeep
        </span>
      ) : null}
      {s?.community != null ? (
        <span className="gk-aw-score">
          <b>{s.community}</b> Community
        </span>
      ) : null}
      {nominee.disconnect ? (
        <span className="gk-aw-disc" title="Gap between critics and players">
          Disconnect {nominee.disconnect.value}
          {nominee.disconnect.band ? ` · ${nominee.disconnect.band}` : ''}
        </span>
      ) : null}
    </div>
  );
}
