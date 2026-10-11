import type { Metadata } from 'next';
import {
  getHomepage,
  type HomepageData,
  type HomepageSection,
  type RankedGame,
  type TopicCard as TopicCardData,
} from '@/lib/public-api';
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
import { HomeGameCard } from './_components/HomeGameCard';

// Trending is live state + server-rotated — render per request (also guarantees
// crawlers get full SSR content, not a cached shell).
export const dynamic = 'force-dynamic';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  title: {
    absolute: 'GamesKeep — Gaming News with a Bias Lens & Honest Game Ratings',
  },
  description:
    'GamesKeep clusters gaming news from many outlets into stories, shows the signals we found in the coverage (sponsorship, affiliate links, review copies), and pairs every game with separated critic and community ratings.',
  alternates: { canonical: siteUrl },
  openGraph: {
    type: 'website',
    url: siteUrl,
    title: 'GamesKeep — Gaming News with a Bias Lens & Honest Game Ratings',
    description:
      'See the same gaming event across every outlet at once, with the coverage signals we found, alongside separated critic/community scores.',
  },
};

/**
 * Which Trending story is highlighted first rotates at server render (no client
 * timer). The LIST ORDER never rotates (Phase P S2: pins hold their position).
 */
const ROTATE_MS = 5 * 60 * 1000;
function rotationIndex(length: number): number {
  return length < 2 ? 0 : Math.floor(Date.now() / ROTATE_MS) % length;
}

function RankCard({
  game,
  rank,
  metric,
}: {
  game: RankedGame;
  rank: number;
  metric: number | null;
}): React.JSX.Element {
  // Top rated ranks on the critic + community layers only (S5 decision, applied
  // in S2) — the card shows exactly the figure it is ranked by.
  const layers = [game.critics, game.community].filter((n): n is number => n != null);
  const mean = metric ?? (layers.length ? layers.reduce((a, b) => a + b, 0) / layers.length : null);
  const headline = scoreToTen(mean);
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

const playersLabel = (n: number | null): string | null =>
  n == null ? null : `~${n.toLocaleString('en-US')} playing (Steam avg)`;

/** One configured section → its markup. Empty item sections render nothing. */
function renderSection(
  sec: HomepageSection,
  next: HomepageSection | undefined,
  prev: HomepageSection | undefined,
  data: HomepageData,
): React.JSX.Element | null {
  const topics = sec.items.map((i) => i.topic).filter((t): t is TopicCardData => t !== null);
  switch (sec.key) {
    case 'briefing':
      return (
        <section className="gk-container gk-home-brief" aria-label={sec.title}>
          <span className="gk-eyebrow">The story, and how it&apos;s being told</span>
          <BriefingStrip briefing={data.briefing} />
        </section>
      );
    case 'trending': {
      if (topics.length === 0) return null;
      const secondary = topics.slice(1, 4);
      return (
        <section className="gk-container gk-hero" aria-label={sec.title}>
          <Hero
            items={sec.items}
            windowHours={sec.windowHours}
            title={sec.title}
            display={data.display}
            initial={rotationIndex(topics.length)}
          />
          {secondary.length > 0 && (
            <div className="gk-hero-secondary">
              {secondary.map((t) => (
                <TopicCard key={t.id} topic={t} display={data.display} layout="stacked" />
              ))}
            </div>
          )}
        </section>
      );
    }
    case 'latest':
      return (
        <section className="gk-container gk-section" aria-label={sec.title}>
          <div className="gk-section-head">
            <div>
              <span className="gk-eyebrow">Across the industry</span>
              <h2 className="gk-section-title">{sec.title}</h2>
            </div>
            <a className="gk-readlink" href="/topics">
              All topics →
            </a>
          </div>
          <div className="gk-portal">
            <MainFeed topics={topics} display={data.display} />
            <aside className="gk-side">
              <LatestNews articles={data.latest} />
              <AdSlot slotKey="home" />
            </aside>
          </div>
        </section>
      );
    case 'focus': {
      const games = sec.items
        .map((i) => (i.game ? data.controversial.find((g) => g.slug === i.game!.slug) : null))
        .filter((g): g is RankedGame => Boolean(g));
      return <GamesInFocus games={games} title={sec.title} />;
    }
    case 'top_rated': {
      const rows = sec.items
        .map((i) => ({
          item: i,
          game: i.game ? data.topRated.find((g) => g.slug === i.game!.slug) : undefined,
        }))
        .filter((r): r is { item: (typeof sec.items)[number]; game: RankedGame } =>
          Boolean(r.game),
        );
      if (rows.length === 0) return null;
      return (
        <section className="gk-container gk-section-tight" aria-label={sec.title}>
          <div className="gk-section-head">
            <div>
              <span className="gk-eyebrow">Ratings, not just news</span>
              <h2 className="gk-section-title">{sec.title}</h2>
            </div>
            <a className="gk-readlink" href="/games/browse">
              Browse all games →
            </a>
          </div>
          <div className="gk-rail">
            {rows.map((r, i) => (
              <RankCard key={r.game.slug} game={r.game} rank={i + 1} metric={r.item.metric} />
            ))}
          </div>
        </section>
      );
    }
    case 'genres':
      return <GenreRail genres={data.genres} title={sec.title} />;
    case 'community':
    case 'newsletter': {
      // Two adjacent blocks share one row (as before); either alone is full width.
      const partner = sec.key === 'community' ? next : prev;
      const paired = partner && (partner.key === 'community' || partner.key === 'newsletter');
      if (paired && sec.key === 'newsletter') return null; // rendered with its partner
      const community = sec.key === 'community' ? sec : paired ? partner : undefined;
      const newsletter = sec.key === 'newsletter' ? sec : paired ? partner : undefined;
      return (
        <section className="gk-container gk-section" aria-label="Community and newsletter">
          <div className={paired ? 'gk-cta-grid' : 'gk-cta-solo'}>
            {community ? <CommunityTeaser title={community.title} /> : null}
            {newsletter ? <Newsletter title={newsletter.title} /> : null}
          </div>
        </section>
      );
    }
    default: {
      // Card grids: Featured (games + stories), By players, New, Our picks, Upcoming.
      if (sec.items.length === 0) return null; // e.g. Our picks hidden while empty
      return (
        <section className="gk-container gk-section-tight" aria-label={sec.title}>
          <div className="gk-section-head">
            <div>
              <h2 className="gk-section-title">{sec.title}</h2>
              {sec.key === 'by_players' ? (
                <p className="gk-section-sub" style={{ margin: 0 }}>
                  Average concurrent players on Steam over the last window, vs the window before.
                  Steam only — consoles publish no live counts.
                </p>
              ) : null}
            </div>
            {sec.key === 'upcoming' || sec.key === 'new' ? (
              <a className="gk-readlink" href="/upcoming">
                All upcoming →
              </a>
            ) : null}
          </div>
          <div className="gk-home-grid">
            {sec.items.map((item, i) =>
              item.topic ? (
                <TopicCard
                  key={`t:${item.topic.slug}`}
                  topic={item.topic}
                  display={data.display}
                  layout="stacked"
                />
              ) : (
                <HomeGameCard
                  key={`g:${item.game?.slug ?? i}`}
                  item={item}
                  windowHours={sec.windowHours}
                  metricLabel={sec.key === 'by_players' ? playersLabel(item.metric) : null}
                  ourPick={sec.key === 'our_picks'}
                />
              ),
            )}
          </div>
        </section>
      );
    }
  }
}

export default async function HomePage(): Promise<React.JSX.Element> {
  const data = await getHomepage();
  const trendingTopics =
    data.sections
      .find((s) => s.key === 'trending')
      ?.items.map((i) => i.topic)
      .filter((t): t is TopicCardData => t !== null) ?? [];

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
      <TrendBar topics={trendingTopics} />

      {data.sections.length === 0 ? (
        <section className="gk-container gk-section">
          <p className="gk-section-sub">The homepage is being prepared — check back in a moment.</p>
        </section>
      ) : null}

      {data.sections.map((sec, i) => {
        const node = renderSection(sec, data.sections[i + 1], data.sections[i - 1], data);
        return node ? (
          <div key={sec.key} className="gk-home-section" data-section={sec.key}>
            {node}
          </div>
        ) : null;
      })}
    </>
  );
}
