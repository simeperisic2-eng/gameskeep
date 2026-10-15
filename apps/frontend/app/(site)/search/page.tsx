import type { Metadata } from 'next';
import { getSearch, type SearchGroup, type SearchHit } from '@/lib/public-api';
import { getSite, siteText } from '@/lib/site';
import { distinctSubtitle } from '@/lib/format';
import { Breadcrumbs } from '../_components/Breadcrumbs';

/**
 * Site search (Phase P S4) — SSR, noindex,follow (a results page is never a
 * landing page; the items it links to are). Works without JavaScript: a plain
 * GET form. One group can be paged with ?type=games|stories|sources.
 */
export const dynamic = 'force-dynamic';

type SP = Promise<{ q?: string | string[]; type?: string | string[]; page?: string | string[] }>;
const first = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;
const GROUPS: { key: SearchGroup; label: string; href: (slug: string) => string }[] = [
  { key: 'games', label: 'Games', href: (s) => `/games/${s}` },
  { key: 'stories', label: 'Stories', href: (s) => `/topics/${s}` },
  { key: 'sources', label: 'Sources', href: (s) => `/sources/${s}` },
];

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const q = (first((await searchParams).q) ?? '').trim().slice(0, 80);
  return {
    title: q ? `Search: ${q}` : 'Search',
    robots: { index: false, follow: true },
  };
}

function Hit({ hit, href }: { hit: SearchHit; href: string }): React.JSX.Element {
  return (
    <li className="gk-result">
      <a className="gk-result-title" href={href}>
        {hit.title}
      </a>
      {hit.category ? <span className="gk-chip">{hit.category}</span> : null}
      {distinctSubtitle(hit.title, hit.subtitle) ? (
        <p className="gk-result-sub">{distinctSubtitle(hit.title, hit.subtitle)}</p>
      ) : null}
    </li>
  );
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: SP;
}): Promise<React.JSX.Element> {
  const sp = await searchParams;
  const q = (first(sp.q) ?? '').trim().slice(0, 200);
  const typeRaw = first(sp.type);
  const type = GROUPS.some((g) => g.key === typeRaw) ? (typeRaw as SearchGroup) : undefined;
  const page = Math.max(1, Number.parseInt(first(sp.page) ?? '1', 10) || 1);
  const [site, data] = await Promise.all([
    getSite(),
    q ? getSearch(q, type, page) : Promise.resolve(null),
  ]);

  const anyHits = data ? GROUPS.some((g) => (data.groups[g.key] ?? []).length > 0) : false;
  const pageSize = data?.pageSize ?? 20;
  const typedTotal = type && data?.totals ? data.totals[type] : 0;
  const pages = type ? Math.max(1, Math.ceil(typedTotal / pageSize)) : 1;
  const link = (t?: SearchGroup, p?: number): string => {
    const qs = new URLSearchParams({ q });
    if (t) qs.set('type', t);
    if (p && p > 1) qs.set('page', String(p));
    return `/search?${qs.toString()}`;
  };

  return (
    <div className="gk-container gk-catalog gk-searchpage">
      <Breadcrumbs
        items={[
          { name: 'Home', url: '/' },
          { name: 'Search', url: '/search' },
        ]}
      />
      <header className="gk-catalog-head">
        <div>
          <span className="gk-eyebrow">{siteText(site, 'search.eyebrow')}</span>
          <h1 className="gk-catalog-title">{q ? `Results for “${q}”` : 'Search'}</h1>
          <p className="gk-section-sub">{siteText(site, 'search.intro')}</p>
        </div>
      </header>

      <form className="gk-searchform" role="search" action="/search" method="get">
        <input
          type="search"
          name="q"
          defaultValue={q}
          maxLength={200}
          aria-label="Search games, stories and sources"
          placeholder="Search games, stories and sources…"
        />
        {type ? <input type="hidden" name="type" value={type} /> : null}
        <button type="submit" className="gk-btn-amber">
          Search
        </button>
      </form>

      {type ? (
        <p className="gk-searchfilter">
          Showing {GROUPS.find((g) => g.key === type)!.label.toLowerCase()} only ·{' '}
          <a href={link()}>All results</a>
        </p>
      ) : null}

      {!q || !data || data.tooShort ? (
        <p className="gk-section-sub">{siteText(site, 'empty.searchPrompt')}</p>
      ) : !anyHits ? (
        <p className="gk-section-sub">{siteText(site, 'empty.search')}</p>
      ) : (
        GROUPS.filter((g) => !type || g.key === type).map((g) => {
          const hits = data.groups[g.key] ?? [];
          if (!hits.length) return null;
          const total = data.totals?.[g.key] ?? hits.length;
          return (
            <section key={g.key} className="gk-resultgroup" aria-label={g.label}>
              <h2 className="gk-section-title">
                {g.label} <span className="gk-result-count">{total}</span>
              </h2>
              <ul className="gk-results">
                {hits.map((h) => (
                  <Hit key={h.slug} hit={h} href={g.href(h.slug)} />
                ))}
              </ul>
              {!type && total > hits.length ? (
                <a className="gk-readlink" href={link(g.key)}>
                  All {total} {g.label.toLowerCase()} →
                </a>
              ) : null}
            </section>
          );
        })
      )}

      {type && pages > 1 ? (
        <nav className="gk-searchpages" aria-label="Result pages">
          {page > 1 ? <a href={link(type, page - 1)}>← Previous</a> : <span />}
          <span>
            Page {page} of {pages}
          </span>
          {page < pages ? <a href={link(type, page + 1)}>Next →</a> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
