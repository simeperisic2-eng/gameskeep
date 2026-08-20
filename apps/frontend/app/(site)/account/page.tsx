import type { Metadata } from 'next';
import Link from 'next/link';
import { getSessionUser } from '@/lib/session';
import { getMyExport } from '@/lib/feed-api';
import { Breadcrumbs } from '../_components/Breadcrumbs';
import { AccountActions } from '../_components/AccountActions';

export const dynamic = 'force-dynamic'; // per-user — never the anonymous cache
export const metadata: Metadata = { title: 'Your account', robots: { index: false } };

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export default async function AccountPage(): Promise<React.JSX.Element> {
  const user = await getSessionUser();
  const crumbs = [
    { name: 'Home', url: `${siteUrl}/` },
    { name: 'Account', url: `${siteUrl}/account` },
  ];

  if (!user) {
    return (
      <main className="gk-container gk-account">
        <Breadcrumbs items={crumbs} />
        <section className="gk-panel gk-feed-empty">
          <h1 className="gk-feed-title">Your account</h1>
          <p>Sign in to manage your profile, ratings and data.</p>
          <a className="gk-btn-amber" href="/login">
            Sign in
          </a>
        </section>
      </main>
    );
  }

  const data = await getMyExport();
  const ratings = data?.ratings ?? [];
  const comments = data?.comments ?? [];
  const follows = data?.follows ?? [];

  // A compact "at a glance" summary — reorganizes data the panel already loads
  // (no new fetch, no new behavior; Slice 5 is cosmetic).
  const stats: { label: string; value: number }[] = [
    { label: 'Ratings', value: ratings.length },
    { label: 'Comments', value: comments.length },
    { label: 'Following', value: follows.length },
  ];

  return (
    <main className="gk-container gk-account">
      <Breadcrumbs items={crumbs} />
      <header className="gk-account-head gk-panel">
        <div className="gk-profile-avatar" aria-hidden>
          {(user.displayName || user.username).slice(0, 1).toUpperCase()}
        </div>
        <div className="gk-account-id">
          <h1 className="gk-profile-name">{user.displayName || user.username}</h1>
          <p className="gk-profile-handle">
            @{user.username}
            {!user.isEmailVerified ? (
              <span className="gk-unverified-tag"> · email not verified</span>
            ) : null}
          </p>
          <dl className="gk-account-stats">
            {stats.map((s) => (
              <div key={s.label} className="gk-account-stat">
                <dt>{s.label}</dt>
                <dd>{s.value.toLocaleString('en-US')}</dd>
              </div>
            ))}
          </dl>
          {user.level ? (
            <div className="gk-level-progress">
              <div className="gk-level-progress-top">
                <span className="gk-level-chip">{user.level.label}</span>
                <span className="gk-level-progress-pct">
                  {Math.round(user.level.progress * 100)}% to next
                </span>
              </div>
              <div className="gk-progress-track" aria-hidden>
                <span
                  className="gk-progress-fill"
                  style={{ width: `${Math.round(user.level.progress * 100)}%` }}
                />
              </div>
            </div>
          ) : null}
          {user.badges.length > 0 ? (
            <ul className="gk-badge-list">
              {user.badges.map((b) => (
                <li key={b.key} className="gk-badge">
                  {b.label}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="gk-account-links">
            <Link href={`/u/${user.username}`}>View public profile</Link> ·{' '}
            <Link href="/feed">Your Feed</Link>
          </p>
        </div>
      </header>

      <div className="gk-account-grid">
        <section className="gk-panel">
          <h2 className="gk-feed-section-title">Your ratings ({ratings.length})</h2>
          {ratings.length > 0 ? (
            <ul className="gk-account-list">
              {ratings.slice(0, 12).map((r) => (
                <li key={r.game}>
                  <Link href={`/games/${r.game}`}>{r.gameName}</Link>
                  <span className="gk-account-score">{(r.score / 10).toFixed(1)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="gk-form-quiet">You haven’t rated anything yet.</p>
          )}
        </section>
        <section className="gk-panel">
          <h2 className="gk-feed-section-title">Your comments ({comments.length})</h2>
          {comments.length > 0 ? (
            <ul className="gk-account-list gk-account-comments">
              {comments.slice(0, 8).map((c, i) => (
                <li key={i}>
                  <span className="gk-account-comment-type">{c.entityType}</span>
                  <span className="gk-account-comment-body">{c.body}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="gk-form-quiet">No comments yet.</p>
          )}
        </section>
      </div>

      <section className="gk-panel">
        <h2 className="gk-feed-section-title">Your data</h2>
        <p className="gk-account-section-note">
          You’re in control of your data. Export a full copy any time, or delete your account —
          we’ll anonymize what has to stay so community scores remain honest.
        </p>
        <AccountActions />
      </section>
    </main>
  );
}
