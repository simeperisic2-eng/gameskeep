import type { Metadata } from 'next';
import { getHomepage, type RankedGame } from '@/lib/public-api';
import { JsonLd } from '@/lib/jsonld';
import { scoreToTen } from '@/lib/format';
import { Hero } from './_components/Hero';
import { TrendBar } from './_components/TrendBar';
import { TopicCard } from './_components/TopicCard';
import { MainFeed } from './_components/MainFeed';
import { LatestNews } from './_components/LatestNews';
import { GamesInFocus } from './_components/GamesInFocus';
import { GenreRail } from './_components/GenreRail';
import { BriefingStrip } from './_components/BriefingStrip';
import { CommunityTeaser } from './_components/CommunityTeaser';
import { Newsletter } from './_components/Newsletter';
import { AdSlot } from './_components/AdSlot';

// Trending is live state + server-rotated — render per request (also guarantees
// crawlers get full SSR content, not a cached shell).
export const dynamic = 'force-dynamic';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  title: {
    absolute: 'GamesKeep — Gaming News with a Bias Lens & Honest Game Ratings',
  },
  description:
    'GamesKeep clusters gaming news from many outlets into stories, shows how influenced and how high-quality the coverage is, and pairs every game with separated critic and community ratings.',
  alternates: { canonical: siteUrl },
  openGraph: {
    type: 'website',
    url: siteUrl,
    title: 'GamesKeep — Gaming News with a Bias Lens & Honest Game Ratings',
    description:
      'See the same gaming event across every outlet at once, with an influence + quality bias bar, alongside separated critic/community scores.',
  },
};

/** Rotate the hero ordering at server render (refresh-rotation; no client timer). */
const ROTATE_MS = 5 * 60 * 1000;
function rotate<T>(items: T[]): T[] {
  if (items.length < 2) return items;
  const shift = Math.floor(Date.now() / ROTATE_MS) % items.length;
  return [...items.slice(shift), ...items.slice(0, shift)];
}

function RankCard({ game, rank }: { game: RankedGame; rank: number }): React.JSX.Element {
  const headline = scoreToTen(game.critics ?? game.our ?? game.community);
  return (
    <a className="gk-rankcard" href={`/games/${game.slug}`}>
      <span className="gk-rankcard-rank">{rank}</span>
      <span className="gk-rankcard-name">{game.name}</span>
      <span className="gk-rankcard-row">
        <span className="gk-score">{headline ?? '—'}</span>
        <span className="gk-score-of">/ 10</span>
      </span>
      <span className="gk-rankcard-sub">Critics + community</span>
    </a>
  );
}

export default async function HomePage(): Promise<React.JSX.Element> {
  const { hero, feed, latest, topRated, controversial, briefing, genres } = await getHomepage();
  const heroTopics = rotate(hero);
  const secondary = heroTopics.slice(1, 4);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'GamesKeep',
    url: siteUrl,
    description:
      'Gaming news with a bias lens and honest, separated game ratings (critic vs community).',
    publisher: { '@type': 'Organization', name: 'GamesKeep', url: siteUrl },
  };

  return (
    <>
      <JsonLd data={jsonLd} />

      {/* Ground-News-style quick-access trending strip (under the header, scrolls away). */}
      <TrendBar topics={hero} />

      {/* HERO — content is the hero; only a thin kicker + the briefing pulse. */}
      <section className="gk-container gk-hero">
        <div className="gk-hero-head">
          <span className="gk-eyebrow">The story, and how it&apos;s being told</span>
          <BriefingStrip briefing={briefing} />
        </div>
        <Hero topics={heroTopics} initial={0} />

        {secondary.length > 0 && (
          <div className="gk-hero-secondary">
            {secondary.map((t) => (
              <TopicCard key={t.id} topic={t} />
            ))}
          </div>
        )}
      </section>

      {/* NEWS PORTAL — main feed + latest-news / ad sidebar. */}
      <section className="gk-container gk-section" aria-label="Across the industry">
        <div className="gk-section-head">
          <div>
            <span className="gk-eyebrow">Across the industry</span>
            <h2 className="gk-section-title">The latest stories</h2>
          </div>
          <a className="gk-readlink" href="/topics">
            All topics →
          </a>
        </div>

        <div className="gk-portal">
          <MainFeed topics={feed} />
          <aside className="gk-side">
            <LatestNews articles={latest} />
            <AdSlot slotKey="home" />
          </aside>
        </div>
      </section>

      {/* GAMES IN FOCUS — disconnect surfaces. */}
      <GamesInFocus games={controversial.slice(0, 3)} />

      {/* BROWSE BY GENRE */}
      <GenreRail genres={genres} />

      {/* TOP RATED — ratings peek (distinct games from Games-in-focus). */}
      <section className="gk-container gk-section-tight">
        <div className="gk-section-head">
          <div>
            <span className="gk-eyebrow">Ratings, not just news</span>
            <h2 className="gk-section-title">Top rated right now</h2>
          </div>
          <a className="gk-readlink" href="/games/browse">
            Browse all games →
          </a>
        </div>
        {topRated.length > 0 ? (
          <div className="gk-rail">
            {topRated.map((g, i) => (
              <RankCard key={g.slug} game={g} rank={i + 1} />
            ))}
          </div>
        ) : (
          <p className="gk-section-sub">Ratings are computing — check back in a moment.</p>
        )}
      </section>

      {/* COMMUNITY TEASER + NEWSLETTER — honest anticipation + the live capture. */}
      <section className="gk-container gk-section">
        <div className="gk-cta-grid">
          <CommunityTeaser />
          <Newsletter />
        </div>
      </section>
    </>
  );
}
