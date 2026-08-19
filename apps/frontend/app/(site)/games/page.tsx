import type { Metadata } from 'next';
import { getDiscovery } from '@/lib/public-api';
import { JsonLd } from '@/lib/jsonld';
import { breadcrumbLd, gameCollectionLd } from '@/lib/schema';
import { Breadcrumbs } from '../_components/Breadcrumbs';
import { GameTile } from '../_components/GameTile';
import { UpcomingCard } from '../_components/UpcomingCard';
import { AdSlot } from '../_components/AdSlot';

// Server-render per request so crawlers get the full curated composition.
export const dynamic = 'force-dynamic';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  title: 'Games — discover by rating, discussion and genre',
  description:
    'Discover games on GamesKeep — top rated, most discussed across outlets, by genre, and coming soon. Separated critic, our and community scores; the full catalog one click away.',
  alternates: { canonical: `${siteUrl}/games` },
  openGraph: {
    type: 'website',
    url: `${siteUrl}/games`,
    title: 'Games — discover by rating, discussion and genre',
    description:
      'Top rated, most discussed, by genre, and coming soon — with separated critic/community scores and the disconnect surfaced where it matters.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Games — discover by rating, discussion and genre',
    description:
      'Top rated, most discussed, by genre, and coming soon — with separated critic/community scores.',
  },
};

/**
 * The /games DISCOVERY page (A1, Steam/IMDb model): a big catalog leads with
 * curation — top rated, most discussed, genres, coming soon — and only shows the
 * exhaustive grid when asked (→ /games/browse). Every section renders from the
 * one pre-computed /public/discovery payload; nothing heavy on request.
 */
export default async function GamesDiscoveryPage(): Promise<React.JSX.Element> {
  const d = await getDiscovery();

  const crumbs = [
    { name: 'Home', url: `${siteUrl}/` },
    { name: 'Games', url: `${siteUrl}/games` },
  ];
  const jsonLd: Record<string, unknown>[] = [
    breadcrumbLd(crumbs),
    gameCollectionLd(d.topRated, {
      name: 'Top rated games',
      url: `${siteUrl}/games`,
      siteUrl,
    }),
  ];

  const browseAll = (
    <a className="gk-browse-all" href="/games/browse">
      Browse all {d.catalogTotal} games →
    </a>
  );

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
            <h1 className="gk-catalog-title">Games</h1>
            <p className="gk-section-sub">
              Start with what&apos;s rising, argued about, or around the corner — separated critic,
              our and community scores, never blended into one number.
            </p>
          </div>
          {browseAll}
        </header>

        {/* TOP RATED */}
        <section className="gk-disco-section" aria-label="Top rated">
          <div className="gk-section-head">
            <div>
              <span className="gk-eyebrow">The strongest</span>
              <h2 className="gk-section-title">Top rated</h2>
            </div>
            <a className="gk-readlink" href="/games/browse">
              All by rating →
            </a>
          </div>
          {d.topRated.length > 0 ? (
            <div className="gk-tile-grid">
              {d.topRated.map((g) => (
                <GameTile key={g.slug} game={g} />
              ))}
            </div>
          ) : (
            <p className="gk-section-sub">Ratings are computing — check back in a moment.</p>
          )}
        </section>

        {/* MOST DISCUSSED — coverage volume across outlets (facts, not a score). */}
        <section className="gk-disco-section" aria-label="Most discussed">
          <div className="gk-section-head">
            <div>
              <span className="gk-eyebrow">In the conversation</span>
              <h2 className="gk-section-title">Most discussed</h2>
              <p className="gk-section-sub">
                The games drawing the most coverage across outlets right now.
              </p>
            </div>
          </div>
          {d.mostDiscussed.length > 0 ? (
            <div className="gk-tile-grid">
              {d.mostDiscussed.map((g) => (
                <GameTile
                  key={g.slug}
                  game={g}
                  note={`${g.articleCount} ${g.articleCount === 1 ? 'article' : 'articles'} · ${g.sourceCount} ${g.sourceCount === 1 ? 'outlet' : 'outlets'}`}
                />
              ))}
            </div>
          ) : (
            <p className="gk-section-sub">Coverage is still clustering — check back in a moment.</p>
          )}
        </section>

        {/* BROWSE BY GENRE — deep-links into the filtered catalog. */}
        {d.genres.length > 0 ? (
          <section className="gk-disco-section" aria-label="Browse by genre">
            <div className="gk-section-head">
              <div>
                <span className="gk-eyebrow">Find your lane</span>
                <h2 className="gk-section-title">Browse by genre</h2>
              </div>
            </div>
            <div className="gk-genre-rail">
              {d.genres.map((g) => (
                <a
                  key={g.value}
                  className="gk-genre-chip"
                  href={`/games/browse?genre=${encodeURIComponent(g.value)}`}
                >
                  <span className="gk-genre-name">{g.value}</span>
                  <span className="gk-genre-count">{g.count}</span>
                </a>
              ))}
            </div>
          </section>
        ) : null}

        {/* COMING SOON — a highlight row; the full slate lives at /upcoming. */}
        {d.comingSoon.length > 0 ? (
          <section className="gk-disco-section" aria-label="Coming soon">
            <div className="gk-section-head">
              <div>
                <span className="gk-eyebrow">Around the corner</span>
                <h2 className="gk-section-title">Coming soon</h2>
              </div>
              <a className="gk-readlink" href="/upcoming">
                Full slate →
              </a>
            </div>
            <div className="gk-upcoming-grid">
              {d.comingSoon.map((g) => (
                <UpcomingCard key={g.slug} game={g} />
              ))}
            </div>
          </section>
        ) : null}

        {/* The exhaustive grid, one click away (never forced on entry). */}
        <div className="gk-disco-foot">
          {browseAll}
          <AdSlot slotKey="games" />
        </div>
      </div>
    </>
  );
}
