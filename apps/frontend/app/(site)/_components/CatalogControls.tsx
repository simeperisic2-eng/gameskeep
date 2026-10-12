import type { CatalogFacet, TagFacet } from '@/lib/public-api';

/**
 * Catalog filter bar (SPEC I5b; BLUEPRINT 2.4; lives at /games/browse since A1) —
 * genre + platform facets and a sort, all as plain anchor links so filtering is
 * pure SSR (crawlable, instant, no client JS). Each chip preserves the OTHER
 * active filters; clicking an active chip toggles it off — and deliberately drops
 * any `page` param, so changing a filter always restarts at page 1. Canonical
 * consolidates filtered views to /games/browse (CLAUDE.md SEO rule).
 */
type Applied = {
  genre: string | null;
  platform: string | null;
  sort: string;
  tags: string[];
  xtags: string[];
};

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
  for (const t of next.tags ?? []) qs.append('tag', t);
  for (const t of next.xtags ?? []) qs.append('xtag', t);
  if (next.sort && next.sort !== 'rating') qs.set('sort', next.sort);
  const s = qs.toString();
  return s ? `/games/browse?${s}` : '/games/browse';
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

/**
 * Phase P S3: one tri-state chip per published tag — neutral → include
 * (`tag=`) → exclude (`xtag=`) → neutral. Plain links (SSR, no client JS); the
 * state is in the URL, so it round-trips. Filtered views are noindex,follow.
 */
function TagRow({
  facets,
  applied,
}: {
  facets: TagFacet[];
  applied: Applied;
}): React.JSX.Element | null {
  if (facets.length === 0) return null;
  const without = (list: string[], slug: string): string[] => list.filter((x) => x !== slug);
  return (
    <div className="gk-facetrow">
      <span className="gk-facet-legend">Tags</span>
      <div className="gk-facet-chips">
        {facets.map((f) => {
          const state = applied.tags.includes(f.slug)
            ? 'include'
            : applied.xtags.includes(f.slug)
              ? 'exclude'
              : 'neutral';
          const next: Partial<Applied> =
            state === 'neutral'
              ? { tags: [...applied.tags, f.slug] }
              : state === 'include'
                ? { tags: without(applied.tags, f.slug), xtags: [...applied.xtags, f.slug] }
                : { xtags: without(applied.xtags, f.slug) };
          const label =
            state === 'neutral'
              ? `${f.name}: any — show only games with it`
              : state === 'include'
                ? `${f.name}: required — exclude it instead`
                : `${f.name}: excluded — clear`;
          return (
            <a
              key={f.slug}
              className={`gk-facetchip gk-tristate is-${state}${f.family === 'issue' ? ' is-issue' : ''}`}
              href={hrefFor(applied, next)}
              aria-label={label}
            >
              <span className="gk-tristate-mark" aria-hidden>
                {state === 'include' ? '+' : state === 'exclude' ? '−' : ''}
              </span>
              {f.name}
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
  tagFacets = [],
  applied,
}: {
  genres: CatalogFacet[];
  platforms: CatalogFacet[];
  tagFacets?: TagFacet[];
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
      <TagRow facets={tagFacets} applied={applied} />
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
