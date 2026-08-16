import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicProfile } from '@/lib/public-api';
import { Breadcrumbs } from '../../_components/Breadcrumbs';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const p = await getPublicProfile(username);
  if (!p) return { title: 'Profile not found', robots: { index: false } };
  const name = p.displayName || p.username;
  return {
    title: `${name} — GamesKeep profile`,
    description: `${name}'s public GamesKeep profile — level, badges and community activity.`,
    alternates: { canonical: `${siteUrl}/u/${p.username}` },
  };
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<React.JSX.Element> {
  const { username } = await params;
  const p = await getPublicProfile(username);
  if (!p) notFound();

  const crumbs = [
    { name: 'Home', url: `${siteUrl}/` },
    { name: p.username, url: `${siteUrl}/u/${p.username}` },
  ];

  return (
    <main className="gk-container gk-profile">
      <Breadcrumbs items={crumbs} />
      <header className="gk-profile-head gk-panel">
        <div className="gk-profile-avatar" aria-hidden>
          {(p.displayName || p.username).slice(0, 1).toUpperCase()}
        </div>
        <div className="gk-profile-id">
          <h1 className="gk-profile-name">{p.displayName || p.username}</h1>
          <p className="gk-profile-handle">@{p.username}</p>
          <div className="gk-profile-chips">
            {p.level ? <span className="gk-level-chip">{p.level.label}</span> : null}
            <span className="gk-profile-joined">
              Joined{' '}
              {new Date(p.joinedAt).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
              })}
            </span>
          </div>
        </div>
      </header>

      <div className="gk-profile-grid">
        <section className="gk-panel gk-profile-stats">
          <h2 className="gk-feed-section-title">Activity</h2>
          <dl className="gk-stat-row">
            <div>
              <dt>Ratings</dt>
              <dd>{p.ratingCount}</dd>
            </div>
            <div>
              <dt>Comments</dt>
              <dd>{p.commentCount}</dd>
            </div>
          </dl>
        </section>
        <section className="gk-panel gk-profile-badges">
          <h2 className="gk-feed-section-title">Badges</h2>
          {p.badges.length > 0 ? (
            <ul className="gk-badge-list">
              {p.badges.map((b) => (
                <li key={b.key} className="gk-badge">
                  {b.label}
                </li>
              ))}
            </ul>
          ) : (
            <p className="gk-form-quiet">No badges yet.</p>
          )}
        </section>
      </div>
    </main>
  );
}
