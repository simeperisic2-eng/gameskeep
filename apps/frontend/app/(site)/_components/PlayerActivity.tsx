import type { GamePlayerCount, PlayerCountPoint } from '@/lib/public-api';

/**
 * Player activity (BLUEPRINT 2.3 premium analytics) — Steam concurrent players
 * with CONTEXT, not just a raw number: playing-now, 24h peak, week-over-week
 * change, and a momentum sparkline. Steam-only and clearly labeled "sample data"
 * in the demo (no live calls; production fills this from the Steam API). Renders
 * only where data exists. Green/red are NOT used here (reserved for bias/
 * disconnect) — the trend uses amber (up) / dim (down).
 */
function Sparkline({ points }: { points: number[] }): React.JSX.Element | null {
  if (points.length < 2) return null;
  const w = 320;
  const h = 52;
  const pad = 5;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const step = (w - pad * 2) / (points.length - 1);
  const coords = points.map((v, i) => {
    const x = pad + i * step;
    const y = pad + (h - pad * 2) * (1 - (v - min) / range);
    return [x, y] as const;
  });
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ');
  const first = coords[0]!;
  const last = coords[coords.length - 1]!;
  const area = `${line} L${last[0]},${h - pad} L${first[0]},${h - pad} Z`;
  return (
    <svg
      className="gk-spark"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Player-count trend, recent weeks"
    >
      <path className="gk-spark-area" d={area} />
      <path className="gk-spark-line" d={line} />
    </svg>
  );
}

export function PlayerActivity({
  playerCount,
  history,
  steamAppId,
}: {
  playerCount: GamePlayerCount | null;
  history: PlayerCountPoint[];
  /** A2: powers the outbound SteamDB "More stats" link (link out ONLY — we
   * never scrape or ingest their numbers; same rule as article excerpts). */
  steamAppId?: number | null;
}): React.JSX.Element | null {
  const series = history.map((p) => p.current).filter((n): n is number => n != null);
  if (!playerCount && series.length === 0) return null;

  const current = playerCount?.current ?? series[series.length - 1] ?? null;
  const peak = playerCount?.peak ?? (series.length > 0 ? Math.max(...series) : null);
  let change: number | null = null;
  if (series.length >= 2) {
    const prev = series[series.length - 2]!;
    const lastVal = series[series.length - 1]!;
    if (prev > 0) change = Math.round(((lastVal - prev) / prev) * 100);
  }

  return (
    <section className="gk-panel gk-players" aria-label="Player activity">
      <div className="gk-panel-head">
        <h2 className="gk-panel-title">Player activity</h2>
        <span className="gk-soft-tag">Steam · sample data</span>
      </div>
      <div className="gk-players-row">
        <div className="gk-players-stat">
          <span className="gk-players-num">{current != null ? current.toLocaleString() : '—'}</span>
          <span className="gk-players-label">Playing now</span>
        </div>
        <div className="gk-players-stat">
          <span className="gk-players-num">{peak != null ? peak.toLocaleString() : '—'}</span>
          <span className="gk-players-label">24h peak</span>
        </div>
        {change != null ? (
          <div className="gk-players-stat">
            <span className={`gk-players-num ${change >= 0 ? 'up' : 'down'}`}>
              {change >= 0 ? '▲' : '▼'} {Math.abs(change)}%
            </span>
            <span className="gk-players-label">Week change</span>
          </div>
        ) : null}
      </div>
      <Sparkline points={series} />
      <div className="gk-players-foot">
        <p className="gk-players-note">
          Steam concurrent players only — consoles don&apos;t publish live counts.
        </p>
        {steamAppId ? (
          <a
            className="gk-more-stats"
            href={`https://steamdb.info/app/${steamAppId}/charts/`}
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            More stats on SteamDB <span aria-hidden>↗</span>
          </a>
        ) : null}
      </div>
    </section>
  );
}
