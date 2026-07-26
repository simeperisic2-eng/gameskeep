import type { CatalogFacet } from '@/lib/public-api';

/**
 * Catalog filter bar (SPEC I5b; BLUEPRINT 2.4) — genre + platform facets and a
 * sort, all as plain anchor links so filtering is pure SSR (crawlable, instant,
 * no client JS). Each chip preserves the OTHER active filters; clicking an active
 * chip toggles it off. Canonical stays on /games so filter combinations never
 * create duplicate-content (CLAUDE.md SEO rule).
 */
type Applied = { genre: string | null; platform: string | null; sort: string };

const SORTS: { key: string; label: string }[] = [
  { key: 'rating', label: 'Top rated' },
  { key: 'name', label: 'A–Z' },
  { key: 'newest', label: 'Newest' },
];

function hrefFor(applied: Applied, change: Partial<Applied>): string {
  const next = { ...applied, ...change };
  const qs = new URLSearchParams();
  if (next.genre) qs.set('genre', next.genre);
  if (next.platform) qs.set('platform', next.platform);
  if (next.sort && next.sort !== 'rating') qs.set('sort', next.sort);
  const s = qs.toString();
  return s ? `/games?${s}` : '/games';
}

function FacetRow({
  legend,
  facets,
  appliedValue,
  applied,
  field,
  limit,
}: {
  legend: string;
  facets: CatalogFacet[];
  appliedValue: string | null;
  applied: Applied;
  field: 'genre' | 'platform';
  limit: number;
}): React.JSX.Element {
  return (
    <div className="gk-facetrow">
      <span className="gk-facet-legend">{legend}</span>
      <div className="gk-facet-chips">
        <a
          className={`gk-facetchip${appliedValue == null ? ' is-active' : ''}`}
          href={hrefFor(applied, { [field]: null } as Partial<Applied>)}
        >
          All
        </a>
        {facets.slice(0, limit).map((f) => {
          const active = appliedValue === f.value.toLowerCase();
          return (
            <a
              key={f.value}
              className={`gk-facetchip${active ? ' is-active' : ''}`}
              href={hrefFor(applied, { [field]: active ? null : f.value } as Partial<Applied>)}
            >
              {f.value}
              <span className="gk-facet-count">{f.count}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

export function CatalogControls({
  genres,
  platforms,
  applied,
}: {
  genres: CatalogFacet[];
  platforms: CatalogFacet[];
  applied: Applied;
}): React.JSX.Element {
  return (
    <div className="gk-catalog-controls">
      <FacetRow
        legend="Genre"
        facets={genres}
        appliedValue={applied.genre}
        applied={applied}
        field="genre"
        limit={14}
      />
      <FacetRow
        legend="Platform"
        facets={platforms}
        appliedValue={applied.platform}
        applied={applied}
        field="platform"
        limit={12}
      />
      <div className="gk-facetrow">
        <span className="gk-facet-legend">Sort</span>
        <div className="gk-facet-chips">
          {SORTS.map((s) => (
            <a
              key={s.key}
              className={`gk-facetchip${applied.sort === s.key ? ' is-active' : ''}`}
              href={hrefFor(applied, { sort: s.key })}
            >
              {s.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
