import type { Metadata } from 'next';
import { getBackendStatus, isAllHealthy } from '@/lib/api';

// Foundation status page (was the I0 landing page). Kept for ops/debugging; the
// real homepage now lives at `/`. Live health → render every request, no index.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'System status', robots: { index: false } };

interface StatusRow {
  label: string;
  ok: boolean;
  detail: string;
}

export default async function StatusPage() {
  const status = await getBackendStatus();
  const healthy = isAllHealthy(status);
  const readiness = status.readiness;

  const rows: StatusRow[] = [
    {
      label: 'Backend API',
      ok: status.reachable,
      detail: status.reachable ? 'reachable' : (status.error ?? 'unreachable'),
    },
  ];

  if (readiness) {
    const { postgres, redis, aiService } = readiness.dependencies;
    rows.push({
      label: 'PostgreSQL',
      ok: postgres.ok,
      detail: postgres.ok
        ? `connected · pgvector ${postgres.vectorExtension ? 'enabled' : 'MISSING'}`
        : (postgres.error ?? 'down'),
    });
    rows.push({
      label: 'Redis',
      ok: redis.ok,
      detail: redis.ok ? 'connected' : (redis.error ?? 'down'),
    });
    rows.push({
      label: 'AI service',
      ok: aiService.ok,
      detail: aiService.ok ? 'reachable' : (aiService.error ?? 'down'),
    });
    const hb = readiness.backgroundJobs.heartbeat;
    rows.push({
      label: 'Background jobs',
      ok: hb.ok,
      detail: hb.ok ? `heartbeat ×${hb.count ?? 0}` : (hb.note ?? 'no heartbeat yet'),
    });
  }

  const mode = (readiness?.mode ?? 'demo').toUpperCase();

  return (
    <main className="gk-wrap">
      <header className="gk-head">
        <div className="gk-logo" aria-label="GamesKeep logo placeholder">
          GK
        </div>
        <span className="gk-mode">{mode}</span>
      </header>

      <h1 className="gk-title">GamesKeep — system status</h1>
      <p className="gk-sub">
        Foundation health panel. The public site lives at <a href="/">the homepage</a>.
      </p>

      <div className={`gk-banner ${healthy ? 'ok' : 'warn'}`}>
        {healthy
          ? 'GamesKeep — foundation OK'
          : 'GamesKeep — foundation: some services are still warming up'}
      </div>

      <section className="gk-card">
        <h2 className="gk-card-title">System status</h2>
        <ul className="gk-list">
          {rows.map((row) => (
            <li key={row.label} className="gk-row">
              <span className={`gk-dot ${row.ok ? 'ok' : 'bad'}`} aria-hidden />
              <span className="gk-row-label">{row.label}</span>
              <span className="gk-row-detail">{row.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      <footer className="gk-foot">{readiness?.dataSource?.description ?? 'demo mode'}</footer>
    </main>
  );
}
