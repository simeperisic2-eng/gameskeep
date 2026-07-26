import type { Metadata } from 'next';
import { getCatalog } from '@/lib/public-api';
import { breadcrumbLd, gameCollectionLd } from '@/lib/schema';
import { Breadcrumbs } from '../_components/Breadcrumbs';
import { CatalogControls } from '../_components/CatalogControls';
import { GameTile } from '../_components/GameTile';
import { AdSlot } from '../_components/AdSlot';

// Server-render per request so crawlers get the full catalog (and any filter
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

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const sp = await searchParams;
  const genre = pretty(first(sp.genre));
  const platform = pretty(first(sp.platform));
  const parts = [genre, platform].filter(Boolean);
  const scope = parts.length > 0 ? `${parts.join(' · ')} games` : 'All games';
  const title = parts.length > 0 ? `${parts.join(' · ')} games` : 'Games catalog';
  const description =
    parts.length > 0
      ? `Browse ${scope} on GamesKeep — separated critic, our and community scores, the critic↔community disconnect, and content flags.`
      : 'Browse every game on GamesKeep — separated critic, our and community ratings, the critic↔community disconnect with context, and factual content flags.';
  return {
    title,
    description,
    // Filter combinations consolidate to the catalog hub (duplicate-content guard).
    alternates: { canonical: `${siteUrl}/games` },
    openGraph: { type: 'website', url: `${siteUrl}/games`, title, description },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function GamesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<React.JSX.Element> {
  const sp = await searchParams;
  const filters = {
    genre: first(sp.genre),
    platform: first(sp.platform),
    sort: first(sp.sort),
  };
  const data = await getCatalog(filters);

  const genreLabel = pretty(data.applied.genre);
  const platformLabel = pretty(data.applied.platform);
  const activeParts = [genreLabel, platformLabel].filter(Boolean);
  const heading = activeParts.length > 0 ? `${activeParts.join(' · ')} games` : 'Every game';

  const crumbs = [
    { name: 'Home', url: `${siteUrl}/` },
    { name: 'Games', url: `${siteUrl}/games` },
  ];
  const jsonLd: Record<string, unknown>[] = [
    breadcrumbLd(crumbs),
    gameCollectionLd(data.games, {
      name: heading,
      url: `${siteUrl}/games`,
      siteUrl,
    }),
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

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
          <div className="gk-tile-grid">
            {data.games.map((g) => (
              <GameTile key={g.slug} game={g} />
            ))}
          </div>
        ) : (
          <div className="gk-catalog-empty">
            <p className="gk-section-sub" style={{ margin: 0 }}>
              No games match these filters yet. <a href="/games">Clear filters</a> to see the full
              catalog.
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
