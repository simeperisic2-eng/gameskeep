import type { SourceCard } from '@/lib/public-api';
import { scoreToTen } from '@/lib/format';
import { SourceIcon } from './SourceIcon';

/**
 * One outlet on the sources index (SPEC I5b; BLUEPRINT 2.5) — ownership, a
 * shared-ownership conflict flag, reputation (avg measured quality of its
 * coverage) and the commercial signal share. The conflict chip uses the amber
 * "attention" treatment, never green/red (those stay reserved for the bias /
 * disconnect indicators).
 */
function Stat({
  label,
  value,
  amber = false,
}: {
  label: string;
  value: string;
  amber?: boolean;
}): React.JSX.Element {
  return (
    <div className="gk-srcstat">
      <span className={`gk-srcstat-val${amber ? ' amber' : ''}`}>{value}</span>
      <span className="gk-srcstat-label">{label}</span>
    </div>
  );
}

export function SourceCardItem({ source }: { source: SourceCard }): React.JSX.Element {
  const reputation = scoreToTen(source.reputation);
  return (
    <a className="gk-srccard" href={`/sources/${source.slug}`}>
      <div className="gk-srccard-head">
        <SourceIcon name={source.name} />
        <div className="gk-srccard-id">
          <span className="gk-srccard-name">{source.name}</span>
          {source.typeLabel ? <span className="gk-srccard-type">{source.typeLabel}</span> : null}
        </div>
      </div>

      <div className="gk-srccard-owner">
        {source.parentCompany ? (
          <>
            <span className="gk-srccard-owner-label">Owned by</span>
            <span className="gk-srccard-owner-name">{source.parentCompany}</span>
            {source.ownerSiblingCount > 0 ? (
              <span className="gk-conflict" title="Shares an owner with other outlets we index">
                <span className="gk-conflict-dot" aria-hidden />+{source.ownerSiblingCount} sibling
                {source.ownerSiblingCount === 1 ? '' : 's'}
              </span>
            ) : null}
          </>
        ) : (
          <span className="gk-srccard-owner-name gk-srccard-owner-indie">Independent owner</span>
        )}
      </div>

      <div className="gk-srccard-stats">
        <Stat label="Reputation" value={reputation ? `${reputation}` : '—'} amber />
        <Stat
          label="Commercial"
          value={source.affiliatePct != null ? `${source.affiliatePct}%` : '—'}
        />
        <Stat label="Stories" value={source.articleCount > 0 ? `${source.articleCount}` : '—'} />
      </div>
    </a>
  );
}
