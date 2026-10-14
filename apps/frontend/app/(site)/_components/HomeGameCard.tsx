import type { HomepageSectionItem } from '@/lib/public-api';
import { scoreToTen } from '@/lib/format';
import { gameStatusLabel, label } from '@/lib/labels';
import { CoverArt } from './CoverArt';
import { DeltaChip } from './DeltaChip';
import { PaidLabel } from './PaidLabel';
import { TagChips } from './TagChips';
import { QuickView } from './QuickView';

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
 * paid item always shows "Promoted · <advertiser>" — no prop or setting hides it
 * (owner decision B: any section may carry paid items). "Our pick" is the
 * neutral team label for ORGANIC picks only — a paid item inside Our picks shows
 * the paid label, never "Our pick". Cover and title are separate links.
 */
export function HomeGameCard({
  item,
  windowHours = null,
  metricLabel = null,
  ourPick = false,
  layout = 'card',
}: {
  item: HomepageSectionItem;
  windowHours?: number | null;
  /** A factual line, e.g. "~68,000 playing" (By players). */
  metricLabel?: string | null;
  ourPick?: boolean;
  /** 'row' = a compact feed row (small cover beside the text), e.g. in Latest. */
  layout?: 'card' | 'row';
}): React.JSX.Element | null {
  const g = item.game;
  if (!g) return null;
  const critics = scoreToTen(g.critics);
  const community = scoreToTen(g.community);
  const when = g.status === 'released' ? null : releaseLabel(g.releaseDate);
  return (
    <article
      className={`gk-hgcard${item.paid ? ' is-promoted' : ''}${layout === 'row' ? ' is-row' : ''}`}
    >
      {item.paid ? (
        <div className="gk-hgcard-flag">
          <PaidLabel paid={item.paid} />
        </div>
      ) : ourPick ? (
        <div className="gk-hgcard-pick">{label('label.ourPick')}</div>
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
          <span>{gameStatusLabel(g.status)}</span>
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
        <TagChips tags={item.tags ?? []} />
        <QuickView slug={g.slug} name={g.name} />
      </div>
    </article>
  );
}
