/**
 * Catalog pagination (A1) — pure-SSR anchor links (crawlable, no client JS),
 * matching the facet-chip pattern: every page is a real `?page=N` URL that
 * preserves the other active filters, so crawlers can walk from page 1 to every
 * game in the catalog. Numbered window (1 … p−1 p p+1 … T) + prev/next, and a
 * "Showing X–Y of N · page P of T" range line for humans.
 */
type Applied = { genre: string | null; platform: string | null; sort: string };

const BASE = '/games/browse';

function hrefFor(applied: Applied, page: number): string {
  const qs = new URLSearchParams();
  if (applied.genre) qs.set('genre', applied.genre);
  if (applied.platform) qs.set('platform', applied.platform);
  if (applied.sort && applied.sort !== 'rating') qs.set('sort', applied.sort);
  if (page > 1) qs.set('page', String(page));
  const s = qs.toString();
  return s ? `${BASE}?${s}` : BASE;
}

/** The page numbers to render: 1 + a window around the current page + the last. */
function pageWindow(page: number, totalPages: number): (number | 'gap')[] {
  const wanted = new Set<number>([1, page - 1, page, page + 1, totalPages]);
  const pages = [...wanted].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  let prev = 0;
  for (const p of pages) {
    if (prev > 0 && p - prev > 1) out.push('gap');
    out.push(p);
    prev = p;
  }
  return out;
}

export function Pagination({
  page,
  totalPages,
  total,
  perPage,
  applied,
}: {
  page: number;
  totalPages: number;
  total: number;
  perPage: number;
  applied: Applied;
}): React.JSX.Element | null {
  if (total <= 0) return null;
  const start = (page - 1) * perPage + 1;
  const end = Math.min(page * perPage, total);

  return (
    <div className="gk-pagination-wrap">
      <p className="gk-pagination-range">
        Showing <b>{start}</b>–<b>{end}</b> of <b>{total}</b> · page <b>{page}</b> of{' '}
        <b>{totalPages}</b>
      </p>
      {totalPages > 1 ? (
        <nav className="gk-pagination" aria-label="Catalog pages">
          {page > 1 ? (
            <a className="gk-pagechip" href={hrefFor(applied, page - 1)} rel="prev">
              ← Prev
            </a>
          ) : (
            <span className="gk-pagechip is-disabled" aria-disabled>
              ← Prev
            </span>
          )}
          {pageWindow(page, totalPages).map((p, i) =>
            p === 'gap' ? (
              <span key={`gap-${i}`} className="gk-page-gap" aria-hidden>
                …
              </span>
            ) : (
              <a
                key={p}
                className={`gk-pagechip num${p === page ? ' is-active' : ''}`}
                href={hrefFor(applied, p)}
                aria-current={p === page ? 'page' : undefined}
              >
                {p}
              </a>
            ),
          )}
          {page < totalPages ? (
            <a className="gk-pagechip" href={hrefFor(applied, page + 1)} rel="next">
              Next →
            </a>
          ) : (
            <span className="gk-pagechip is-disabled" aria-disabled>
              Next →
            </span>
          )}
        </nav>
      ) : null}
    </div>
  );
}
