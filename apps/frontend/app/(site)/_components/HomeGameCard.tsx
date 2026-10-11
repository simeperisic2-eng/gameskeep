import type { HomepageSectionItem } from '@/lib/public-api';
import { scoreToTen } from '@/lib/format';
import { CoverArt } from './CoverArt';
import { DeltaChip } from './DeltaChip';

const STATUS_LABEL: Record<string, string> = {
  announced: 'Announced',
  in_development: 'In development',
  early_access: 'Early access',
  released: 'Released',
  delisted: 'Delisted',
};

function releaseLabel(date: string | null): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : date;
}

/**
 * A game in a homepage section (Phase P S2). The PAID label is render-forced: a
 * promoted item always shows "Promoted · <advertiser>" — there is no prop or
 * setting that hides it (only discovery sections ever carry one). "Our pick" is
 * the neutral, never-sold team label. Cover and title are separate links (no
 * nested anchors).
 */
export function HomeGameCard({
  item,
  windowHours = null,
  metricLabel = null,
  ourPick = false,
}: {
  item: HomepageSectionItem;
  windowHours?: number | null;
  /** A factual line, e.g. "~68,000 playing" (By players). */
  metricLabel?: string | null;
  ourPick?: boolean;
}): React.JSX.Element | null {
  const g = item.game;
  if (!g) return null;
  const critics = scoreToTen(g.critics);
  const community = scoreToTen(g.community);
  const when = g.status === 'released' ? null : releaseLabel(g.releaseDate);
  return (
    <article className={`gk-hgcard${item.promoted ? ' is-promoted' : ''}`}>
      {item.promoted ? (
        <div className="gk-hgcard-flag" aria-label="Promoted content">
          <span className="gk-slot-flag">Promoted</span>
          <span className="gk-hgcard-flag-by">Paid promotion · {item.promoted.advertiser}</span>
        </div>
      ) : ourPick ? (
        <div className="gk-hgcard-pick">Our pick</div>
      ) : null}
      <a className="gk-hgcard-cover" href={`/games/${g.slug}`} tabIndex={-1} aria-hidden>
        <CoverArt label={g.name} imageUrl={g.coverUrl} variant="thumb" />
      </a>
      <div className="gk-hgcard-body">
        <h3 className="gk-hgcard-name">
          <a className="gk-title-link" href={`/games/${g.slug}`}>
            {g.name}
          </a>
        </h3>
        <div className="gk-hgcard-meta">
          <span>{STATUS_LABEL[g.status] ?? g.status}</span>
          {when ? <span>{when}</span> : null}
          {g.genres[0] ? <span>{g.genres[0]}</span> : null}
        </div>
        {critics || community ? (
          <div className="gk-hgcard-scores">
            {critics ? (
              <span>
                Critics <b>{critics}</b>
              </span>
            ) : null}
            {community ? (
              <span>
                Community <b>{community}</b>
              </span>
            ) : null}
          </div>
        ) : null}
        {metricLabel || item.delta ? (
          <div className="gk-hgcard-metric">
            {metricLabel ? <span>{metricLabel}</span> : null}
            <DeltaChip delta={item.delta} windowHours={windowHours} />
          </div>
        ) : null}
      </div>
    </article>
  );
}
