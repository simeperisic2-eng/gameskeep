import type { AwardCategory, AwardNominee } from '@/lib/public-api';
import { AwardNomineeMeta } from './AwardNomineeMeta';

/**
 * Reveal/archive display for one category (SPEC I7, Slice 3): the two outcomes —
 * Critics' Choice and Community Choice — shown SEPARATELY, side by side (the
 * jury-vs-players split is the point, never merged), with the full nominee list
 * and each nominee's community-vote share below.
 */
function WinnerCard({
  kind,
  nominee,
}: {
  kind: 'community' | 'critics';
  nominee: AwardNominee | null;
}): React.JSX.Element {
  const label = kind === 'community' ? 'Community Choice' : 'Critics’ Choice';
  if (!nominee) {
    return (
      <div className={`gk-aw-winner is-${kind} is-empty`}>
        <span className="gk-aw-winner-kind">{label}</span>
        <span className="gk-aw-winner-name">To be decided</span>
      </div>
    );
  }
  return (
    <a className={`gk-aw-winner is-${kind}`} href={`/games/${nominee.slug}`}>
      <span className="gk-aw-winner-kind">{label}</span>
      <span className="gk-aw-winner-name">{nominee.name}</span>
      <AwardNomineeMeta nominee={nominee} />
    </a>
  );
}

export function AwardCategoryResults({ category }: { category: AwardCategory }): React.JSX.Element {
  const community = category.nominees.find((n) => n.isCommunityWinner) ?? null;
  const critics = category.nominees.find((n) => n.isCriticsWinner) ?? null;
  return (
    <section className="gk-aw-cat">
      <div className="gk-aw-cat-head">
        <h2 className="gk-aw-cat-title">{category.label}</h2>
        {category.sponsor ? (
          <span className="gk-aw-sponsor">
            {category.sponsor.sold ? category.sponsor.label : 'Sponsor slot'}
          </span>
        ) : null}
      </div>

      <div className="gk-aw-winners">
        <WinnerCard kind="community" nominee={community} />
        <WinnerCard kind="critics" nominee={critics} />
      </div>

      <details className="gk-aw-allnoms">
        <summary>
          All {category.nominees.length} {category.nominees.length === 1 ? 'nominee' : 'nominees'}
        </summary>
        <div className="gk-aw-nomlist">
          {category.nominees.map((n) => (
            <div key={n.nominationId} className="gk-aw-nom">
              <div className="gk-aw-nom-head">
                <a className="gk-aw-nom-name" href={`/games/${n.slug}`}>
                  {n.name}
                </a>
                <span className="gk-aw-nom-tags">
                  {n.isCommunityWinner ? (
                    <span className="gk-aw-tag is-community">Community</span>
                  ) : null}
                  {n.isCriticsWinner ? <span className="gk-aw-tag is-critics">Critics</span> : null}
                </span>
              </div>
              <AwardNomineeMeta nominee={n} />
              {category.totalVotes > 0 ? (
                <div className="gk-aw-bar-label">
                  {Math.round(n.ratio * 100)}% of the community vote
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
