import type { Metadata } from 'next';
import Link from 'next/link';
import { getSessionUser } from '@/lib/session';
import { getFeed, type FeedItem } from '@/lib/feed-api';
import { relativeTime, truncateWords } from '@/lib/format';
import { Breadcrumbs } from '../_components/Breadcrumbs';
import { FollowButton } from '../_components/FollowButton';

// PER-USER — must never sit on the anonymous edge cache (decision 9). Logged-out
// visitors keep the curated cached homepage untouched; this page is always fresh.
export const dynamic = 'force-dynamic';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  title: 'Your Feed',
  description: 'Your personal GamesKeep feed — the latest from the games and topics you follow.',
  robots: { index: false }, // a private, per-user page is never indexed
  alternates: { canonical: `${siteUrl}/feed` },
};

function FeedCard({ item }: { item: FeedItem }): React.JSX.Element {
  const when = relativeTime(item.publishDate);
  const href = `/${item.via.type === 'game' ? 'games' : 'topics'}/${item.via.slug}`;
  return (
    <article className="gk-feed-item">
      <div className="gk-feed-item-via">
        <Link href={href} className="gk-chip-link">
          {item.via.type === 'game' ? '🎮' : '🗞'} {item.via.name}
        </Link>
      </div>
      <h3 className="gk-feed-item-title">
        {item.url ? (
          <a href={item.url} target="_blank" rel="noopener noreferrer nofollow">
            {item.title}
          </a>
        ) : (
          item.title
        )}
      </h3>
      {item.excerpt ? (
        <p className="gk-feed-item-excerpt">{truncateWords(item.excerpt, 180)}</p>
      ) : null}
      <div className="gk-feed-item-meta">
        {item.sourceName ? (
          <span>
            {item.sourceSlug ? (
              <Link href={`/sources/${item.sourceSlug}`}>{item.sourceName}</Link>
            ) : (
              item.sourceName
            )}
          </span>
        ) : null}
        {when ? <span>{when}</span> : null}
      </div>
    </article>
  );
}

export default async function FeedPage(): Promise<React.JSX.Element> {
  const user = await getSessionUser();
  const crumbs = [
    { name: 'Home', url: `${siteUrl}/` },
    { name: 'Your Feed', url: `${siteUrl}/feed` },
  ];

  if (!user) {
    return (
      <main className="gk-container gk-yourfeed">
        <Breadcrumbs items={crumbs} />
        <section className="gk-panel gk-feed-empty">
          <h1 className="gk-feed-title">Your Feed</h1>
          <p>
            Sign in to follow the games and topics you care about and build a personal feed of their
            latest coverage. Browsing stays open — no account needed to read.
          </p>
          <a className="gk-btn-amber" href="/account">
            Sign in
          </a>
        </section>
      </main>
    );
  }

  const feed = await getFeed();
  const empty = !feed || feed.isEmpty;

  return (
    <main className="gk-container gk-yourfeed">
      <Breadcrumbs items={crumbs} />
      <header className="gk-feed-head">
        <div>
          <h1 className="gk-feed-title">Your Feed</h1>
          <p className="gk-feed-sub">
            The latest from what you follow, {user.displayName || user.username}.
          </p>
        </div>
        {user.level ? (
          <span className="gk-level-chip" title="Your level">
            {user.level.label}
          </span>
        ) : null}
      </header>

      {empty ? (
        <section className="gk-panel gk-feed-empty">
          <h2>Follow something to fill your feed</h2>
          <p>
            You’re not following anything yet. Follow games and topics and their latest coverage
            shows up here.
          </p>
          <div className="gk-feed-empty-actions">
            <a className="gk-btn-amber" href="/games">
              Browse games
            </a>
            <a className="gk-btn-ghost" href="/topics">
              Browse topics
            </a>
          </div>
        </section>
      ) : (
        <div className="gk-feed-grid">
          <aside className="gk-feed-following gk-panel">
            <h2 className="gk-feed-section-title">Following</h2>
            {feed!.followedGames.length > 0 ? (
              <div className="gk-feed-follow-group">
                <h3>Games</h3>
                <ul className="gk-feed-follow-list">
                  {feed!.followedGames.map((g) => (
                    <li key={g.slug}>
                      <Link href={`/games/${g.slug}`}>{g.name}</Link>
                      <FollowButton entityType="game" slug={g.slug} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {feed!.followedTopics.length > 0 ? (
              <div className="gk-feed-follow-group">
                <h3>Topics</h3>
                <ul className="gk-feed-follow-list">
                  {feed!.followedTopics.map((t) => (
                    <li key={t.slug}>
                      <Link href={`/topics/${t.slug}`}>{t.title}</Link>
                      <FollowButton entityType="topic" slug={t.slug} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </aside>

          <section className="gk-feed-stream">
            <h2 className="gk-feed-section-title">Latest</h2>
            {feed!.items.length > 0 ? (
              feed!.items.map((item) => <FeedCard key={item.id} item={item} />)
            ) : (
              <p className="gk-feed-quiet">
                Nothing new from your follows yet — check back after the next pull.
              </p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
