import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTagPage, type TagPageData } from '@/lib/public-api';
import { JsonLd } from '@/lib/jsonld';
import { breadcrumbLd, gameCollectionLd } from '@/lib/schema';
import { Breadcrumbs } from '../../../_components/Breadcrumbs';
import { GameTile } from '../../../_components/GameTile';
import { Pagination } from '../../../_components/Pagination';

/**
 * A tag page (Phase P S3): every game carrying a PUBLISHED tag, SSR + paginated,
 * schema.org CollectionPage with the game list, the editors' short intro. A tag
 * with fewer published games than the admin-set minimum (`tags.indexMinGames`,
 * default 5) renders but is noindex and stays out of the sitemap.
 */
export const dynamic = 'force-dynamic';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const firstOf = (v: string | string[] | undefined): string | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

const load = cache(
  (slug: string, page: string | null): Promise<TagPageData | null> => getTagPage(slug, page),
);

const pageUrl = (slug: string, page: number): string =>
  `${siteUrl}/games/tag/${slug}${page > 1 ? `?page=${page}` : ''}`;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await load(slug, firstOf((await searchParams).page));
  if (!data) return { title: 'Tag not found', robots: { index: false } };
  const title = `${data.tag.name} games${data.page > 1 ? ` — page ${data.page}` : ''}`;
  const description =
    data.tag.intro ??
    `${data.total} ${data.total === 1 ? 'game' : 'games'} tagged “${data.tag.name}” on GamesKeep — with separated critic, our and community scores.`;
  const url = pageUrl(data.tag.slug, data.page);
  return {
    title,
    description,
    alternates: { canonical: url },
    robots: data.indexable ? undefined : { index: false, follow: true },
    openGraph: { type: 'website', url, title, description },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function TagPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}): Promise<React.JSX.Element> {
  const { slug } = await params;
  const data = await load(slug, firstOf((await searchParams).page));
  if (!data) notFound();

  const url = pageUrl(data.tag.slug, data.page);
  const crumbs = [
    { name: 'Home', url: `${siteUrl}/` },
    { name: 'Games', url: `${siteUrl}/games` },
    { name: data.tag.name, url: `${siteUrl}/games/tag/${data.tag.slug}` },
  ];
  const list = gameCollectionLd(data.games, {
    name: `${data.tag.name} games`,
    url,
    siteUrl,
  });
  const jsonLd: Record<string, unknown>[] = [
    breadcrumbLd(crumbs),
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: `${data.tag.name} games`,
      url,
      ...(data.tag.intro ? { description: data.tag.intro } : {}),
      mainEntity: { ...list, '@context': undefined },
    },
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
            <span className="gk-eyebrow">{data.tag.family === 'issue' ? 'Issue' : 'Tag'}</span>
            <h1 className="gk-catalog-title">{data.tag.name}</h1>
            {data.tag.intro ? <p className="gk-section-sub">{data.tag.intro}</p> : null}
          </div>
          <span className="gk-catalog-count">
            <b>{data.total}</b> {data.total === 1 ? 'game' : 'games'}
          </span>
        </header>

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
              applied={{ genre: null, platform: null, sort: 'rating' }}
              basePath={`/games/tag/${data.tag.slug}`}
            />
          </>
        ) : (
          <div className="gk-catalog-empty">
            <p className="gk-section-sub" style={{ margin: 0 }}>
              No games carry this tag yet. <a href="/games/browse">Browse the catalog</a>.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
