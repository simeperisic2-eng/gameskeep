import type { GameTagGroups, PublicIssueTag } from '@/lib/public-api';
import { shortDate } from '@/lib/format';

/**
 * A game's published tags (Phase P S3), grouped Content / Issues.
 * - Content tags: chips, no provenance line (owner).
 * - Issue tags: the truthful provenance ("Added by editors" / "Reported by
 *   players · confirmed by editors"), first-seen + last-confirmed dates; a
 *   vote-driven issue without fresh signal reads "Past issue" with its range;
 *   a resolved one names its patch.
 * "Unusual voting activity" appears only when the admin switch is on.
 */
function IssueRow({ t }: { t: PublicIssueTag }): React.JSX.Element {
  const first = shortDate(t.firstSeen);
  const confirmed = shortDate(t.lastConfirmed);
  return (
    <li className={`gk-issue is-${t.status}`}>
      <div className="gk-issue-head">
        <a className="gk-issue-name" href={`/games/tag/${t.slug}`}>
          {t.name}
        </a>
        {t.status === 'past' ? (
          <span className="gk-issue-state">
            Past issue · {first} – {shortDate(t.pastUntil)}
          </span>
        ) : t.status === 'resolved' ? (
          <span className="gk-issue-state">
            Resolved{t.patchRef ? ` in ${t.patchRef}` : ''} · {shortDate(t.resolvedAt)}
          </span>
        ) : null}
        {t.unusual ? <span className="gk-flag-unusual">Unusual voting activity</span> : null}
      </div>
      {t.provenance ? <p className="gk-issue-prov">{t.provenance}</p> : null}
      <p className="gk-issue-dates">
        First seen {first}
        {confirmed ? <span> · Last confirmed {confirmed}</span> : null}
      </p>
    </li>
  );
}

export function GameTags({ groups }: { groups: GameTagGroups }): React.JSX.Element | null {
  if (groups.content.length === 0 && groups.issues.length === 0) return null;
  return (
    <section className="gk-panel gk-gametags" aria-label="Tags">
      <div className="gk-panel-head">
        <h2 className="gk-panel-title">Tags</h2>
      </div>
      {groups.content.length > 0 ? (
        <div className="gk-gametags-group">
          <h3 className="gk-gametags-h">Content</h3>
          <ul className="gk-tagchips">
            {groups.content.map((t) => (
              <li key={t.slug}>
                <a className="gk-tagchip" href={`/games/tag/${t.slug}`}>
                  {t.name}
                </a>
                {t.unusual ? (
                  <span className="gk-flag-unusual"> Unusual voting activity</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {groups.issues.length > 0 ? (
        <div className="gk-gametags-group">
          <h3 className="gk-gametags-h">Issues</h3>
          <ul className="gk-issues">
            {groups.issues.map((t) => (
              <IssueRow key={t.slug} t={t} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
