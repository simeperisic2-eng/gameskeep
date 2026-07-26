import type { Metadata } from 'next';
import { getUpcoming } from '@/lib/public-api';
import { breadcrumbLd, gameCollectionLd } from '@/lib/schema';
import { Breadcrumbs } from '../_components/Breadcrumbs';
import { UpcomingCard } from '../_components/UpcomingCard';
import { AdSlot } from '../_components/AdSlot';

// Countdowns are computed at render — force-dynamic so they're always current
// (and crawlers get the full slate as real HTML).
export const dynamic = 'force-dynamic';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  title: 'Upcoming games',
  description:
    'The upcoming games slate on GamesKeep — release dates, live countdowns and status for the most-anticipated titles, from announced to early access.',
  alternates: { canonical: `${siteUrl}/upcoming` },
  openGraph: {
    type: 'website',
    url: `${siteUrl}/upcoming`,
    title: 'Upcoming games',
    description:
      'Release dates, countdowns and status for the games on the horizon — announced, in development and in early access.',
  },
  twitter: { card: 'summary_large_image', title: 'Upcoming games' },
};

export default async function UpcomingPage(): Promise<React.JSX.Element> {
  const games = await getUpcoming();
  const dated = games.filter((g) => g.releaseDate).length;

  const crumbs = [
    { name: 'Home', url: `${siteUrl}/` },
    { name: 'Upcoming', url: `${siteUrl}/upcoming` },
  ];
  const jsonLd: Record<string, unknown>[] = [
    breadcrumbLd(crumbs),
    gameCollectionLd(games, { name: 'Upcoming games', url: `${siteUrl}/upcoming`, siteUrl }),
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
            <span className="gk-eyebrow">What&apos;s next</span>
            <h1 className="gk-catalog-title">Upcoming games</h1>
            <p className="gk-section-sub">
              The slate on the horizon — release dates, live countdowns and status. Hype voting
              arrives with accounts.
            </p>
          </div>
          <span className="gk-catalog-count">
            <b>{games.length}</b> {games.length === 1 ? 'title' : 'titles'}
            {dated > 0 ? <span className="gk-catalog-count-of"> · {dated} dated</span> : null}
          </span>
        </header>

        {games.length > 0 ? (
          <div className="gk-upcoming-grid">
            {games.map((g) => (
              <UpcomingCard key={g.slug} game={g} />
            ))}
          </div>
        ) : (
          <div className="gk-catalog-empty">
            <p className="gk-section-sub" style={{ margin: 0 }}>
              No upcoming titles are lined up right now — check back as new games are announced.
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
