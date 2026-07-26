import type { Metadata } from 'next';
import { getBiasStatus, listArticleBias, listTopicBias } from '../lib';
import BiasManager from '../_components/BiasManager';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Admin · Bias engine', robots: { index: false } };

export default async function BiasPage() {
  const [status, articles, topics] = await Promise.all([
    getBiasStatus(),
    listArticleBias(),
    listTopicBias(),
  ]);

  return (
    <main className="gk-admin">
      <p className="gk-crumbs">
        <a href="/admin">Admin</a> / Bias engine
      </p>
      <header className="gk-admin-head">
        <h1 className="gk-title" style={{ fontSize: 26 }}>
          Bias engine <span className="gk-count">({status.counts.articlesScored} scored)</span>
        </h1>
        <span className="gk-mode">TRANSPARENT · ADDITIVE</span>
      </header>
      <p className="gk-sub">
        Two transparent, explainable axes per article — Influenced↔Independent (factual, mostly
        automatic) and Slop↔Top (humbler, editor-leaning) — each a sum of named, tunable weights
        with a stored breakdown of <em>why</em>. Tune weights, override any score (auto value kept
        underneath; never clobbered by a re-tune), write the human judgmental note, and edit the
        internal-only field. Every action is audit-logged. The public bias bar is I5; this is the
        engine + inspection.
      </p>

      <section className="gk-card" style={{ marginBottom: 18 }}>
        <h2 className="gk-card-title">Engine stats</h2>
        <ul className="gk-admin-grid">
          <li>Articles scored: {status.counts.articlesScored}</li>
          <li>With editor override: {status.counts.articlesWithOverride}</li>
          <li>Topics with distribution: {status.counts.topicsWithDistribution}</li>
          <li>
            Gate: {status.gate.enabled ? 'on' : 'off'} · gap {status.gate.minEventGapDays}d ·{' '}
            {status.gate.requireDifferentEventKind ? 'diff-kind' : 'any-kind'}
          </li>
          <li>Event kinds: {status.eventKinds.length}</li>
        </ul>
        {status.lastRecompute?.finishedAt ? (
          <p className="gk-sub" style={{ marginTop: 8 }}>
            Last recompute: {new Date(status.lastRecompute.finishedAt).toLocaleString()} (
            {status.lastRecompute.reason})
          </p>
        ) : null}
      </section>

      <BiasManager status={status} articles={articles} topics={topics} />
    </main>
  );
}
