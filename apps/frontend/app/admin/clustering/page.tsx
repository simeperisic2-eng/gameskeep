import type { Metadata } from 'next';
import { getClusterStatus, listClusterTopics } from '../lib';
import ClusteringManager from '../_components/ClusteringManager';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Admin · Clustering', robots: { index: false } };

export default async function ClusteringPage() {
  const [status, topics] = await Promise.all([getClusterStatus(), listClusterTopics()]);

  return (
    <main className="gk-admin">
      <p className="gk-crumbs">
        <a href="/admin">Admin</a> / Topics &amp; clustering
      </p>
      <header className="gk-admin-head">
        <h1 className="gk-title" style={{ fontSize: 26 }}>
          Topics &amp; clustering <span className="gk-count">({status.totalTopics} topics)</span>
        </h1>
        <span className="gk-mode">
          FEED · {status.provider.provider.toUpperCase()}
          {status.provider.live ? ' (LIVE)' : ' (DEMO)'}
        </span>
      </header>
      <p className="gk-sub">
        The news engine: a realistic mock feed is pulled, embedded and clustered into topics by a
        real engine (only the feed is mocked). Tune the threshold/window, re-cluster, and
        merge/split/reassign — every action is audit-logged. Public topic pages are I5.
      </p>

      <section className="gk-card" style={{ marginBottom: 18 }}>
        <h2 className="gk-card-title">Engine stats</h2>
        <ul className="gk-admin-grid">
          <li>
            Articles: {status.aggregatedArticles} aggregated / {status.totalArticles} total
          </li>
          <li>Embedded: {status.articlesWithEmbedding}</li>
          <li>With primary topic: {status.articlesWithPrimaryTopic}</li>
          <li>Topics: {status.totalTopics}</li>
          <li>Multi-source topics: {status.multiSourceTopics}</li>
          <li>Topics with AI summary: {status.topicsWithSummary}</li>
        </ul>
        {status.lastIngest?.finishedAt ? (
          <p className="gk-sub" style={{ marginTop: 8 }}>
            Last ingest: {new Date(status.lastIngest.finishedAt).toLocaleString()} (
            {status.lastIngest.reason}, +{status.lastIngest.newArticles ?? 0} new)
          </p>
        ) : null}
      </section>

      <ClusteringManager settings={status.settings} topics={topics} />
    </main>
  );
}
