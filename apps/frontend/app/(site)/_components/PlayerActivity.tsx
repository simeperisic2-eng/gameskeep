import type { GamePlayerCount, PlayerCountPoint } from '@/lib/public-api';

/**
 * Player activity (BLUEPRINT 2.3 premium analytics; chart upgraded in B2) —
 * Steam concurrent players as a PROPER dated time series, not a bare number:
 * current / peak (recorded) / week-change above a y-scaled, dated area chart
 * with per-point dots and the latest point highlighted.
 *
 * HONESTY RULE (B2): Steam's Web API has NO historical player-count endpoint —
 * SteamDB/SteamCharts built their archives by recording the current number
 * themselves for years. We do the same: this chart shows the history WE have
 * recorded (seeded in demo; the production sweep appends), and the "More
 * stats" link hands off to SteamDB for the deep past. The copy says so.
 *
 * The chart is ONE viewBox'd SVG at width:100% (no media queries) so it
 * reflows at any width — the CSS-collapse lesson applied. Amber/neutral only;
 * green/red stay reserved for bias/disconnect.
 */
const W = 640;
const H = 230;
const PAD_L = 46;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 30;

/** Round a maximum up to a "nice" axis ceiling (1/2/2.5/5 × 10^n). */
function niceCeil(n: number): number {
  if (n <= 0) return 1;
  const exp = Math.floor(Math.log10(n));
  const base = 10 ** exp;
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (n <= m * base) return m * base;
  }
  return 10 * base;
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function tickDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

interface ChartPoint {
  at: string;
  v: number;
}

function TimeSeriesChart({ points }: { points: ChartPoint[] }): React.JSX.Element | null {
  if (points.length < 2) return null;

  const yMax = niceCeil(Math.max(...points.map((p) => p.v)));
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const x = (i: number): number => PAD_L + (plotW * i) / (points.length - 1);
  const y = (v: number): number => PAD_T + plotH * (1 - v / yMax);

  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`)
    .join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${PAD_T + plotH} L${PAD_L},${PAD_T + plotH} Z`;

  // ~4 dated x ticks, first → last, evenly spread across the recorded window.
  const tickIdx = [0, 1, 2, 3].map((k) => Math.round(((points.length - 1) * k) / 3));
  const gridVals = [0, yMax / 2, yMax];
  const last = points.length - 1;

  return (
    <svg
      className="gk-chart"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Recorded Steam concurrent players, ${tickDate(points[0]!.at)} to ${tickDate(points[last]!.at)}`}
    >
      <defs>
        <linearGradient id="gk-chart-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(245, 179, 1)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="rgb(245, 179, 1)" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* y grid + scale labels */}
      {gridVals.map((v) => (
        <g key={v}>
          <line
            className="gk-chart-grid"
            x1={PAD_L}
            x2={W - PAD_R}
            y1={y(v)}
            y2={y(v)}
            aria-hidden
          />
          <text className="gk-chart-ylabel" x={PAD_L - 8} y={y(v) + 3.5} textAnchor="end">
            {compact(v)}
          </text>
        </g>
      ))}

      {/* dated x ticks */}
      {tickIdx.map((i) => (
        <text
          key={i}
          className="gk-chart-xlabel"
          x={x(i)}
          y={H - 8}
          textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'}
        >
          {tickDate(points[i]!.at)}
        </text>
      ))}

      <path className="gk-chart-area" d={area} fill="url(#gk-chart-fill)" />
      <path className="gk-chart-line" d={line} />

      {/* per-point dots; the latest is highlighted */}
      {points.map((p, i) => (
        <circle
          key={i}
          className={i === last ? 'gk-chart-dot is-latest' : 'gk-chart-dot'}
          cx={x(i)}
          cy={y(p.v)}
          r={i === last ? 4 : 2.2}
        />
      ))}
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
  const points: ChartPoint[] = history
    .filter((p): p is PlayerCountPoint & { current: number } => p.current != null)
    .map((p) => ({ at: p.capturedAt, v: p.current }));
  if (!playerCount && points.length === 0) return null;

  const series = points.map((p) => p.v);
  const current = playerCount?.current ?? series[series.length - 1] ?? null;
  // Peak = the highest number in OUR recorded history (incl. any stored 24h
  // peak) — "recorded" because that's genuinely all anyone has (see above).
  const peakRecorded =
    series.length > 0 || playerCount?.peak != null
      ? Math.max(...series, playerCount?.peak ?? 0)
      : null;
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
          <span className="gk-players-num">
            {peakRecorded != null && peakRecorded > 0 ? peakRecorded.toLocaleString() : '—'}
          </span>
          <span className="gk-players-label">Peak (recorded)</span>
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
      <TimeSeriesChart points={points} />
      <div className="gk-players-foot">
        <p className="gk-players-note">
          Steam concurrent players only (consoles don&apos;t publish live counts) — this is the
          history we&apos;ve recorded; Steam has no past-players API, we accumulate our own.
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
