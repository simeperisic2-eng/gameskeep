import type { PublicGameRating, CriticEntry, WebRatingEntry } from '@/lib/public-api';
import { scoreToTen } from '@/lib/format';
import { SourceIcon } from './SourceIcon';

/**
 * The RATING BLOCK (BLUEPRINT 2.3) — the IMDb/RT face. Three SEPARATED layers,
 * never mixed into one number: Our score / Media Critics / Community (itself two
 * never-merged lines — Our community + Across the web). Below them the signature
 * critic↔community DISCONNECT (band + the gap + sub-levels + an editor context
 * tag where set). Scores display 1–10 one decimal (stored 0–100). Red is used
 * ONLY for a large disconnect — the one signal that flags a real problem.
 *
 * Leak-proof: consumes only the public rating DTO (effective values, the editor
 * context tag, the visible burst flag) — no naive score, no raw overrides, no
 * burst-info internals.
 */
const BAND_LABEL: Record<string, string> = {
  agree: 'In agreement',
  mild: 'Mild gap',
  notable: 'Notable gap',
  large: 'Large gap',
};

function Pillar({
  label,
  sub,
  score,
  amber = false,
}: {
  label: string;
  sub: string;
  score: number | null;
  amber?: boolean;
}): React.JSX.Element {
  const display = scoreToTen(score);
  return (
    <div className="gk-pillar">
      <span className="gk-pillar-label">{label}</span>
      {display ? (
        <span className={`gk-pillar-score${amber ? ' amber' : ''}`}>
          {display}
          <span className="gk-pillar-of">/10</span>
        </span>
      ) : (
        <span className="gk-pillar-nodata">No score yet</span>
      )}
      <span className="gk-pillar-sub">{sub}</span>
    </div>
  );
}

function CommunityPillar({
  community,
  web,
  webEntries,
}: {
  community: { score: number | null; count: number | null };
  web: { score: number | null };
  webEntries: WebRatingEntry[];
}): React.JSX.Element {
  const ourDisplay = scoreToTen(community.score);
  const webEntry = webEntries[0] ?? null;
  const webDisplay = scoreToTen(web.score);
  return (
    <div className="gk-pillar gk-pillar-community">
      <span className="gk-pillar-label">Community</span>
      {/* Two clearly-labeled lines, NEVER merged into one number. */}
      <div className="gk-comm-lines">
        <div className="gk-comm-line">
          <span className="gk-comm-name">Our community</span>
          <span className="gk-comm-score">{ourDisplay ?? '—'}</span>
          <span className="gk-comm-meta">
            {community.count && community.count > 0
              ? `${community.count} ${community.count === 1 ? 'rating' : 'ratings'} · weighted`
              : 'No ratings yet'}
          </span>
        </div>
        <div className="gk-comm-line">
          <span className="gk-comm-name">Across the web</span>
          <span className="gk-comm-score">{webDisplay ?? '—'}</span>
          <span className="gk-comm-meta">
            {webEntry ? `${webEntry.label} · estimate` : 'Estimate'}
          </span>
        </div>
      </div>
    </div>
  );
}

function Disconnect({
  d,
  critics,
  community,
}: {
  d: NonNullable<PublicGameRating['disconnect']>;
  critics: number | null;
  community: number | null;
}): React.JSX.Element {
  const band = d.band in BAND_LABEL ? d.band : 'mild';
  const gap = (d.value / 10).toFixed(1);
  const criticsTen = scoreToTen(critics);
  const communityTen = scoreToTen(community);
  const ourVsCritics = d.ourVsCritics != null ? (d.ourVsCritics / 10).toFixed(1) : null;
  const communityVsWeb = d.communityVsWeb != null ? (d.communityVsWeb / 10).toFixed(1) : null;
  return (
    <div className={`gk-disc gk-gd-${band}`}>
      <div className="gk-disc-primary">
        <div className="gk-disc-end">
          <span className="gk-disc-end-label">Critics</span>
          <span className="gk-disc-end-num">{criticsTen ?? '—'}</span>
        </div>
        <div className="gk-disc-mid">
          <span className="gk-disc-band">{BAND_LABEL[band]}</span>
          <span className="gk-disc-gap">
            <span className="gk-disc-gap-num">Δ {gap}</span>
          </span>
        </div>
        <div className="gk-disc-end">
          <span className="gk-disc-end-label">Community</span>
          <span className="gk-disc-end-num">{communityTen ?? '—'}</span>
        </div>
      </div>

      {d.contextTag ? (
        <p className="gk-disc-context">
          <span className="gk-disc-context-tag">Why the gap</span>
          {d.contextTag}
        </p>
      ) : null}

      {ourVsCritics || communityVsWeb ? (
        <div className="gk-disc-subs">
          {ourVsCritics ? (
            <span className="gk-disc-sub">
              Our score ↔ Critics <b>Δ {ourVsCritics}</b>
            </span>
          ) : null}
          {communityVsWeb ? (
            <span className="gk-disc-sub">
              Our community ↔ Across the web <b>Δ {communityVsWeb}</b>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CriticEntries({ entries }: { entries: CriticEntry[] }): React.JSX.Element {
  return (
    <details className="gk-critics">
      <summary className="gk-critics-summary">
        How {entries.length} {entries.length === 1 ? 'outlet' : 'outlets'} rated it
      </summary>
      <ul className="gk-critic-list">
        {entries.map((e, i) => {
          const inner = (
            <>
              <SourceIcon name={e.outlet} />
              <div className="gk-critic-body">
                <div className="gk-critic-top">
                  <span className="gk-critic-outlet">{e.outlet}</span>
                  <span className="gk-critic-score">{e.native ?? scoreToTen(e.score)}</span>
                </div>
                {e.excerpt ? <p className="gk-critic-excerpt">{e.excerpt}</p> : null}
              </div>
            </>
          );
          return (
            <li key={`${e.outlet}-${i}`} className="gk-critic-row">
              {e.url ? (
                <a href={e.url} target="_blank" rel="noopener noreferrer nofollow">
                  {inner}
                </a>
              ) : (
                inner
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

export function RatingBlock({
  rating,
  name,
}: {
  rating: PublicGameRating;
  name: string;
}): React.JSX.Element {
  return (
    <section className="gk-panel gk-ratings" aria-label={`Ratings for ${name}`}>
      <div className="gk-panel-head">
        <h2 className="gk-panel-title">Ratings</h2>
        {rating.unusualActivity ? (
          <span className="gk-unusual" title="Anomaly detection flagged a voting burst">
            Unusual voting activity
          </span>
        ) : null}
      </div>

      <div className="gk-rating-layers">
        <Pillar label="Our score" sub="Editorial" score={rating.our.score} amber />
        <Pillar
          label="Media Critics"
          sub={
            rating.critics.count && rating.critics.count > 0
              ? `${rating.critics.count} ${rating.critics.count === 1 ? 'outlet' : 'outlets'}`
              : 'Aggregated'
          }
          score={rating.critics.score}
        />
        <CommunityPillar
          community={rating.community}
          web={rating.web}
          webEntries={rating.webEntries}
        />
      </div>

      {rating.disconnect ? (
        <Disconnect
          d={rating.disconnect}
          critics={rating.critics.score}
          community={rating.community.score}
        />
      ) : null}

      {rating.criticEntries.length > 0 ? <CriticEntries entries={rating.criticEntries} /> : null}
    </section>
  );
}
