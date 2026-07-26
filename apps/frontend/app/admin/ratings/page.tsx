import type { Metadata } from 'next';
import { getRatingStatus, listGameRatings } from '../lib';
import RatingsManager from '../_components/RatingsManager';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Admin · Rating engine', robots: { index: false } };

export default async function RatingsPage() {
  const [status, games] = await Promise.all([getRatingStatus(), listGameRatings()]);

  return (
    <main className="gk-admin">
      <p className="gk-crumbs">
        <a href="/admin">Admin</a> / Rating engine
      </p>
      <header className="gk-admin-head">
        <h1 className="gk-title" style={{ fontSize: 26 }}>
          Rating engine{' '}
          <span className="gk-count">({status.counts.gamesWithCommunity} scored)</span>
        </h1>
        <span className="gk-mode">3 LAYERS · WEIGHTED</span>
      </header>
      <p className="gk-sub">
        Three separated rating layers (Our / Media Critics / Community — never merged), a
        critic↔community disconnect with band + editor-only context tag, and a transparent
        community-weighting model: per-vote credibility 0→1.0 (never above) plus a VISIBLE “unusual
        activity” flag with credibility-aware damping. Credibility is the primary defense against a
        review-bomb; damping is secondary. Critics are never touched by weighting. Public game-page
        UI is I5; this is the engine + inspection.
      </p>

      <section className="gk-card" style={{ marginBottom: 18 }}>
        <h2 className="gk-card-title">Engine stats</h2>
        <ul className="gk-admin-grid">
          <li>Games with a summary: {status.counts.gamesWithSummary}</li>
          <li>With a community score: {status.counts.gamesWithCommunity}</li>
          <li>Flagged (unusual activity): {status.counts.gamesFlagged}</li>
        </ul>
        {status.lastRecompute?.finishedAt ? (
          <p className="gk-sub" style={{ marginTop: 8 }}>
            Last recompute: {new Date(status.lastRecompute.finishedAt).toLocaleString()} (
            {status.lastRecompute.reason}, {status.lastRecompute.gamesProcessed ?? 0} games)
          </p>
        ) : null}
      </section>

      <RatingsManager status={status} games={games} />
    </main>
  );
}
