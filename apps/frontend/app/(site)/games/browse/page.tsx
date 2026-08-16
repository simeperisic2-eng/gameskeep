import type { Metadata } from 'next';
import { getCatalog } from '@/lib/public-api';
import { JsonLd } from '@/lib/jsonld';
import { breadcrumbLd, gameCollectionLd } from '@/lib/schema';
import { Breadcrumbs } from '../../_components/Breadcrumbs';
import { CatalogControls } from '../../_components/CatalogControls';
import { GameTile } from '../../_components/GameTile';
import { Pagination } from '../../_components/Pagination';
import { AdSlot } from '../../_components/AdSlot';

// Server-render per request so crawlers get every catalog page (and any filter
// view) as real HTML, not a client shell.
export const dynamic = 'force-dynamic';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/** Title-case a filter value for the heading/meta ("rpg" → "RPG" kept as-is). */
function pretty(v: string | null): string | null {
  if (!v) return null;
  return v.length <= 3 ? v.toUpperCase() : v.charAt(0).toUpperCase() + v.slice(1);
}

/**
 * Canonical rules (A1, duplicate-content guard): filter combinations consolidate
 * to the browse hub; UNFILTERED paginated pages self-canonicalize (each ?page=N
 * is distinct content — the crawl path that reaches every game).
 */
function canonicalFor(applied: { genre: string | null; platform: string | null }, page: number) {
  const filtered = Boolean(applied.genre || applied.platform);
  if (!filtered && page > 1) return `${siteUrl}/games/browse?page=${page}`;
  return `${siteUrl}/games/browse`;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const sp = await searchParams;
  const genre = pretty(first(sp.genre));
  const platform = pretty(first(sp.platform));
  const pageNum = Math.max(1, Number.parseInt(first(sp.page) ?? '1', 10) || 1);
  const parts = [genre, platform].filter(Boolean);
  const scope = parts.length > 0 ? `${parts.join(' · ')} games` : 'All games';
  const title =
    (parts.length > 0 ? `${parts.join(' · ')} games` : 'Browse all games') +
    (pageNum > 1 ? ` — page ${pageNum}` : '');
  const description =
    parts.length > 0
      ? `Browse ${scope} on GamesKeep — separated critic, our and community scores, the critic↔community disconnect, and content flags.`
      : 'Browse every game on GamesKeep — separated critic, our and community ratings, the critic↔community disconnect with context, and factual content flags.';
  return {
    title,
    description,
    alternates: {
      canonical: canonicalFor({ genre: first(sp.genre), platform: first(sp.platform) }, pageNum),
    },
    openGraph: { type: 'website', url: `${siteUrl}/games/browse`, title, description },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<React.JSX.Element> {
  const sp = await searchParams;
  const data = await getCatalog({
    genre: first(sp.genre),
    platform: first(sp.platform),
    sort: first(sp.sort),
    page: first(sp.page),
  });

  const genreLabel = pretty(data.applied.genre);
  const platformLabel = pretty(data.applied.platform);
  const activeParts = [genreLabel, platformLabel].filter(Boolean);
  // Filtered views re-title + re-count ("RPG games — 47 of 199").
  const heading = activeParts.length > 0 ? `${activeParts.join(' · ')} games` : 'Every game';

  const crumbs = [
    { name: 'Home', url: `${siteUrl}/` },
    { name: 'Games', url: `${siteUrl}/games` },
    { name: 'Browse all', url: `${siteUrl}/games/browse` },
  ];
  const jsonLd: Record<string, unknown>[] = [
    breadcrumbLd(crumbs),
    gameCollectionLd(data.games, {
      name: heading,
      url: `${siteUrl}/games/browse`,
      siteUrl,
    }),
  ];

  return (
    <>
      <JsonLd data={jsonLd} />

      <div className="gk-container gk-catalog">
        <Breadcrumbs
          items={crumbs.map((c) => ({ name: c.name, url: c.url.replace(siteUrl, '') || '/' }))}
        />

        <header className="gk-catalog-head">
          <div>
            <span className="gk-eyebrow">Ratings &amp; rankings</span>
            <h1 className="gk-catalog-title">{heading}</h1>
            <p className="gk-section-sub">
              Separated critic, our and community scores — never blended into one number — with the
              gap surfaced where it&apos;s real.
            </p>
          </div>
          <span className="gk-catalog-count">
            <b>{data.total}</b> {data.total === 1 ? 'game' : 'games'}
            {data.total !== data.catalogTotal ? (
              <span className="gk-catalog-count-of"> of {data.catalogTotal}</span>
            ) : null}
          </span>
        </header>

        <CatalogControls genres={data.genres} platforms={data.platforms} applied={data.applied} />

        {data.games.length > 0 ? (
          <>
            <div className="gk-tile-grid">
              {data.games.map((g) => (
                <GameTile key={g.slug} game={g} />
              ))}
            </div>
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              total={data.total}
              perPage={data.perPage}
              applied={data.applied}
            />
          </>
        ) : (
          <div className="gk-catalog-empty">
            <p className="gk-section-sub" style={{ margin: 0 }}>
              No games match these filters yet. <a href="/games/browse">Clear filters</a> to see the
              full catalog.
            </p>
          </div>
        )}

        <div className="gk-catalog-foot">
          <AdSlot />
        </div>
      </div>
    </>
  );
}
