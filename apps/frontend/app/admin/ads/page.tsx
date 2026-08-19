import type { Metadata } from 'next';
import { getAdAnalytics, getAdInventory, listResource, type Row } from '../lib';
import { PlacementStatus } from '../_components/PlacementStatus';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Advertising · Control Panel',
  robots: { index: false },
};

const money = (cents: unknown, currency: unknown): string =>
  typeof cents === 'number'
    ? new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: typeof currency === 'string' ? currency : 'USD',
      }).format(cents / 100)
    : '—';

const day = (v: unknown): string =>
  typeof v === 'string' && v
    ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(v))
    : '—';

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

export default async function AdsPage(): Promise<React.JSX.Element> {
  const [inventory, analytics, placements, slots] = await Promise.all([
    getAdInventory(),
    getAdAnalytics(),
    listResource('ad-placements'),
    listResource('ad-slots'),
  ]);
  const slotKeyById = new Map(slots.map((s: Row) => [String(s.id), String(s.key)]));

  return (
    <div className="gk-cp-page">
      <header className="gk-cp-page-head">
        <h1 className="gk-cp-page-title">Advertising</h1>
        <p className="gk-cp-page-sub">
          Inventory + placements. No on-site payment — arrange by email, then set a placement to{' '}
          <b>active</b> once paid. Every active placement carries a labeled Promoted flag.
        </p>
      </header>

      <section className="gk-cp-stats">
        <Stat label="Slots" value={analytics.totals.slots} />
        <Stat label="Free slots" value={analytics.totals.free} />
        <Stat label="Impressions" value={analytics.totals.impressions} />
        <Stat label="Clicks" value={analytics.totals.clicks} />
      </section>

      <section className="gk-cp-card">
        <h2 className="gk-cp-card-title">Inventory · every slot across the site</h2>
        <div className="gk-cp-tablewrap">
          <table className="gk-cp-table">
            <thead>
              <tr>
                <th>Slot</th>
                <th>Page</th>
                <th>State</th>
                <th>Advertiser</th>
                <th>Window</th>
              </tr>
            </thead>
            <tbody>
              {inventory.map((r) => (
                <tr key={r.slotKey}>
                  <td>
                    <b>{r.label}</b>
                    <span className="gk-cp-dim"> · {r.slotKey}</span>
                  </td>
                  <td>{r.page}</td>
                  <td>
                    <span className={`gk-adstate is-${r.state}`}>{r.state}</span>
                  </td>
                  <td>{r.placement?.advertiser ?? '—'}</td>
                  <td className="gk-cp-dim">
                    {r.placement
                      ? `${day(r.placement.startsAt)} → ${day(r.placement.endsAt)}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="gk-cp-card">
        <h2 className="gk-cp-card-title">Per-slot analytics</h2>
        <p className="gk-cp-note">
          Aggregate only — impressions/clicks are mock in the demo (no per-render write).
        </p>
        <div className="gk-cp-tablewrap">
          <table className="gk-cp-table">
            <thead>
              <tr>
                <th>Slot</th>
                <th>Impressions</th>
                <th>Clicks</th>
                <th>CTR</th>
                <th>Placements</th>
                <th>Occupied</th>
              </tr>
            </thead>
            <tbody>
              {analytics.slots.map((s) => (
                <tr key={s.slotKey}>
                  <td>{s.label}</td>
                  <td>{s.impressions.toLocaleString('en-US')}</td>
                  <td>{s.clicks.toLocaleString('en-US')}</td>
                  <td>{s.ctr}%</td>
                  <td>{s.placements}</td>
                  <td>{s.occupied ? 'yes' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="gk-cp-card">
        <div className="gk-cp-card-head">
          <h2 className="gk-cp-card-title">Placements</h2>
          <a className="gk-cp-link" href="/admin/ad-placements">
            Manage placements →
          </a>
        </div>
        <div className="gk-cp-tablewrap">
          <table className="gk-cp-table">
            <thead>
              <tr>
                <th>Advertiser</th>
                <th>Slot</th>
                <th>Headline</th>
                <th>Price</th>
                <th>Status (activate)</th>
              </tr>
            </thead>
            <tbody>
              {placements.length === 0 ? (
                <tr>
                  <td colSpan={5} className="gk-cp-dim">
                    No placements yet. Create one under “Manage placements”.
                  </td>
                </tr>
              ) : (
                placements.map((p: Row) => (
                  <tr key={String(p.id)}>
                    <td>{String(p.advertiserName ?? '—')}</td>
                    <td className="gk-cp-dim">{slotKeyById.get(String(p.slotId)) ?? '—'}</td>
                    <td>{String(p.headline ?? '—')}</td>
                    <td>{money(p.priceCents, p.currency)}</td>
                    <td>
                      <PlacementStatus id={String(p.id)} status={String(p.status ?? 'draft')} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
