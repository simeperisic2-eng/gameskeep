import type { Metadata } from 'next';
import {
  getHomepage,
  type HomepageData,
  type HomepageSection,
  type HomepageSectionItem,
  type TopicCard as TopicCardData,
} from '@/lib/public-api';
import { JsonLd } from '@/lib/jsonld';
import { scoreToTen } from '@/lib/format';
import { Hero } from './_components/Hero';
import { TrendBar } from './_components/TrendBar';
import { TopicCard } from './_components/TopicCard';
import { MainFeed } from './_components/MainFeed';
import { LatestNews } from './_components/LatestNews';
import { GamesInFocus, type FocusEntry } from './_components/GamesInFocus';
import { GenreRail } from './_components/GenreRail';
import { BriefingStrip } from './_components/BriefingStrip';
import { CommunityTeaser } from './_components/CommunityTeaser';
import { Newsletter } from './_components/Newsletter';
import { AdSlot } from './_components/AdSlot';
import { HomeGameCard } from './_components/HomeGameCard';
import { PaidLabel } from './_components/PaidLabel';
import { TagChips } from './_components/TagChips';

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

/**
 * A Top rated card. Organic cards carry their rank; a PAID insert (owner decision
 * B) carries the render-forced label instead of a number and shows its TRUE score
 * — payment never changes data.
 */
function RankCard({
  item,
  rank,
}: {
  item: HomepageSectionItem;
  rank: number | null;
}): React.JSX.Element | null {
  const head = item.paid ? (
    <span className="gk-rankcard-paid">
      <PaidLabel paid={item.paid} />
    </span>
  ) : (
    <span className="gk-rankcard-rank">{rank}</span>
  );
  if (item.topic) {
    return (
      <a
        className={`gk-rankcard${item.paid ? ' is-paid' : ''}`}
        href={`/topics/${item.topic.slug}`}
      >
        {head}
        <span className="gk-rankcard-name">{item.topic.title}</span>
        <span className="gk-rankcard-sub">Story</span>
      </a>
    );
  }
  const game = item.game;
  if (!game) return null;
  // Top rated ranks on the critic + community layers only (S5 decision, applied
  // in S2) — the card shows exactly the figure it is ranked by.
  const layers = [game.critics, game.community].filter((n): n is number => n != null);
  const mean =
    item.metric ?? (layers.length ? layers.reduce((a, b) => a + b, 0) / layers.length : null);
  const headline = scoreToTen(mean);
  return (
    <a className={`gk-rankcard${item.paid ? ' is-paid' : ''}`} href={`/games/${game.slug}`}>
      {head}
      <span className="gk-rankcard-name">{game.name}</span>
      <span className="gk-rankcard-row">
        <span className="gk-score">{headline ?? '—'}</span>
        <span className="gk-score-of">/ 10</span>
      </span>
      <span className="gk-rankcard-sub">Critics + community</span>
      <TagChips tags={item.tags ?? []} asLinks={false} />
    </a>
  );
}

/** Stable, duplicate-safe React key (a paid item may also rank organically). */
const itemKey = (it: HomepageSectionItem, i: number): string =>
  `${it.paid ? 'paid' : 'org'}:${it.topic?.slug ?? it.game?.slug ?? ''}:${i}`;

const playersLabel = (n: number | null): string | null =>
  n == null ? null : `~${n.toLocaleString('en-US')} playing (Steam avg)`;

/** One configured section → its markup. Empty item sections render nothing. */
function renderSection(
  sec: HomepageSection,
  next: HomepageSection | undefined,
  prev: HomepageSection | undefined,
  data: HomepageData,
): React.JSX.Element | null {
  switch (sec.key) {
    case 'briefing':
      return (
        <section className="gk-container gk-home-brief" aria-label={sec.title}>
          <span className="gk-eyebrow">The story, and how it&apos;s being told</span>
          <BriefingStrip briefing={data.briefing} />
        </section>
      );
    case 'trending': {
      const rows = sec.items.filter((i) => i.topic || i.game);
      if (rows.length === 0) return null;
      const secondary = sec.items.filter((i) => i.topic).slice(1, 4);
      return (
        <section className="gk-container gk-hero" aria-label={sec.title}>
          <Hero
            items={sec.items}
            windowHours={sec.windowHours}
            title={sec.title}
            display={data.display}
            initial={rotationIndex(rows.length)}
          />
          {secondary.length > 0 && (
            <div className="gk-hero-secondary">
              {secondary.map((it, i) => (
                <TopicCard
                  key={itemKey(it, i)}
                  topic={it.topic!}
                  display={data.display}
                  layout="stacked"
                  paid={it.paid}
                  tags={it.tags}
                />
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
            <MainFeed items={sec.items} display={data.display} />
            <aside className="gk-side">
              <LatestNews articles={data.latest} />
              <AdSlot slotKey="home" />
            </aside>
          </div>
        </section>
      );
    case 'focus': {
      const entries = sec.items
        .map((i): FocusEntry | null => {
          const ranked = i.game ? data.controversial.find((g) => g.slug === i.game!.slug) : null;
          if (i.paid && i.game) {
            // A paid game keeps the score card; its TRUE numbers (the ranked row
            // when it also ranks, else its two public layers — never invented).
            return {
              paid: i.paid,
              tags: i.tags,
              game: ranked ?? {
                slug: i.game.slug,
                name: i.game.name,
                our: null,
                critics: i.game.critics,
                community: i.game.community,
                web: null,
                disconnectValue: null,
                disconnectBand: null,
              },
            };
          }
          if (i.paid) return { paidItem: i };
          return ranked ? { game: ranked, tags: i.tags } : null;
        })
        .filter((e): e is FocusEntry => e !== null);
      return <GamesInFocus entries={entries} display={data.display} title={sec.title} />;
    }
    case 'top_rated': {
      const rows = sec.items.filter((i) => i.game || (i.paid && i.topic));
      if (rows.length === 0) return null;
      // Organic cards keep their numbers; paid inserts are never numbered.
      let n = 0;
      const ranks = rows.map((r) => (r.paid ? null : (n += 1)));
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
              <RankCard key={itemKey(r, i)} item={r} rank={ranks[i] ?? null} />
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
                  key={itemKey(item, i)}
                  topic={item.topic}
                  display={data.display}
                  layout="stacked"
                  paid={item.paid}
                  tags={item.tags}
                />
              ) : (
                <HomeGameCard
                  key={itemKey(item, i)}
                  item={item}
                  windowHours={sec.windowHours}
                  metricLabel={sec.key === 'by_players' ? playersLabel(item.metric) : null}
                  // A paid item inside Our picks shows its paid label, never "Our pick".
                  ourPick={sec.key === 'our_picks' && !item.paid}
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
      // The quick-access strip is organic only (a paid story is labeled in the
      // Trending section itself and never appears unlabeled here).
      ?.items.filter((i) => !i.paid)
      .map((i) => i.topic)
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
