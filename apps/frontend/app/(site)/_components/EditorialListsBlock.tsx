import type { GameEditorialLists } from '@/lib/public-api';

/**
 * "On N editorial lists" (Phase P S4) — this game's positions on outlets'
 * CONFIRMED year-end lists, each linking out to the original list (never a copy
 * of it), the data-only comparison lines, and the consensus pages it is on.
 */
export function EditorialListsBlock({
  data,
  note,
}: {
  data: GameEditorialLists | undefined;
  note: string;
}): React.JSX.Element | null {
  if (!data || data.count === 0) return null;
  return (
    <section className="gk-panel gk-edlists" aria-label="Editorial lists">
      <div className="gk-panel-head">
        <h2 className="gk-panel-title">
          On {data.count} editorial {data.count === 1 ? 'list' : 'lists'}
        </h2>
      </div>
      <ul className="gk-edlists-rows">
        {data.lists.map((l) => (
          <li key={l.id}>
            <a href={l.url} target="_blank" rel="noopener noreferrer nofollow">
              <span className="gk-edlists-rank">#{l.rank}</span>
              <span className="gk-edlists-main">
                <span className="gk-edlists-outlet">{l.outlet}</span>
                <span className="gk-edlists-title">
                  {l.category} {l.year} <span aria-hidden>↗</span>
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
      {data.lines.length ? (
        <ul className="gk-edlists-lines">
          {data.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {data.consensus.length ? (
        <p className="gk-edlists-consensus">
          {data.consensus.map((c, i) => (
            <span key={`${c.year}:${c.categoryKey}`}>
              {i > 0 ? ' · ' : null}
              <a href={`/lists/${c.year}/${c.categoryKey}`}>
                #{c.position} in the {c.label} {c.year} consensus
              </a>
            </span>
          ))}
        </p>
      ) : null}
      <p className="gk-edlists-note">{note}</p>
    </section>
  );
}
