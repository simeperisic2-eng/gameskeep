import type { Metadata } from 'next';
import { getDashboard, type DashboardData } from './lib';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Dashboard · Control Panel', robots: { index: false } };

const fmtDate = (iso: string | null): string =>
  iso
    ? new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
      }).format(new Date(iso))
    : '—';

const pct = (n: number, d: number): string => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');

function Stat({ label, value }: { label: string; value: number | string }): React.JSX.Element {
  return (
    <div className="gk-cp-stat">
      <span className="gk-cp-stat-value">
        {typeof value === 'number' ? value.toLocaleString('en-US') : value}
      </span>
      <span className="gk-cp-stat-label">{label}</span>
    </div>
  );
}

export default async function DashboardPage(): Promise<React.JSX.Element> {
  const d: DashboardData = await getDashboard();
  const c = d.counts;

  return (
    <div className="gk-cp-page">
      <header className="gk-cp-page-head">
        <h1 className="gk-cp-page-title">Dashboard</h1>
        <p className="gk-cp-page-sub">
          Aggregate, anonymous overview — no per-user tracking. Generated {fmtDate(d.generatedAt)}.
        </p>
      </header>

      <section className="gk-cp-stats">
        <Stat label="Topics" value={c.topics} />
        <Stat label="Articles" value={c.articles} />
        <Stat label="Games" value={c.games} />
        <Stat label="Sources" value={c.sources} />
        <Stat label="Users" value={c.users} />
        <Stat label="Comments" value={c.comments} />
        <Stat label="Ratings" value={c.ratings} />
        <Stat label="Subscribers" value={c.subscribers} />
      </section>

      <div className="gk-cp-cols">
        <section className="gk-cp-card">
          <h2 className="gk-cp-card-title">
            Community activity · last {d.activity.windowDays} days
          </h2>
          <div className="gk-cp-stats gk-cp-stats-sm">
            <Stat label="New ratings" value={d.activity.ratings} />
            <Stat label="New comments" value={d.activity.comments} />
            <Stat label="New votes" value={d.activity.votes} />
            <Stat label="New users" value={d.activity.newUsers} />
          </div>
          <p className="gk-cp-note">{d.trafficNote}</p>
        </section>

        <section className="gk-cp-card">
          <h2 className="gk-cp-card-title">Pipeline health</h2>
          <ul className="gk-cp-health">
            <li>
              <span>Articles embedded</span>
              <b>
                {d.pipeline.articlesEmbedded.toLocaleString('en-US')} /{' '}
                {d.pipeline.articlesTotal.toLocaleString('en-US')}{' '}
                <em>({pct(d.pipeline.articlesEmbedded, d.pipeline.articlesTotal)})</em>
              </b>
            </li>
            <li>
              <span>Topics summarized</span>
              <b>
                {d.pipeline.topicsSummarized.toLocaleString('en-US')} /{' '}
                {d.pipeline.topicsTotal.toLocaleString('en-US')}{' '}
                <em>({pct(d.pipeline.topicsSummarized, d.pipeline.topicsTotal)})</em>
              </b>
            </li>
            <li>
              <span>Games with computed ratings</span>
              <b>{d.pipeline.ratingsComputed.toLocaleString('en-US')}</b>
            </li>
            <li>
              <span>Last rating recompute</span>
              <b>{fmtDate(d.pipeline.lastRatingComputedAt)}</b>
            </li>
          </ul>
        </section>
      </div>

      <div className="gk-cp-cols">
        <section className="gk-cp-card">
          <h2 className="gk-cp-card-title">Top topics</h2>
          <ol className="gk-cp-toplist">
            {d.topTopics.map((t) => (
              <li key={t.slug}>
                <a href={`/topics/${t.slug}`}>{t.title}</a>
                <span className="gk-cp-toplist-n">{t.articleCount} articles</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="gk-cp-card">
          <h2 className="gk-cp-card-title">Source performance</h2>
          <ol className="gk-cp-toplist">
            {d.topSources.map((s) => (
              <li key={s.slug}>
                <a href={`/sources/${s.slug}`}>{s.name}</a>
                <span className="gk-cp-toplist-n">{s.articleCount} articles</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
