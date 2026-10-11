'use client';

import { useState } from 'react';
import { adminFetch } from '../_lib/adminFetch';
import type { ListsConfig, SlotPlacementRow } from '../lib';

/**
 * List / slot configuration (SPEC I8, Slice 4 → Phase P S2). The homepage rail
 * sizes, order and pins now live on the Homepage screen (sections); this page
 * keeps the "New" window (shared by /upcoming and the New section) and the slot
 * placement overview. Every save is audited server-side.
 */

const day = (v: string | null): string =>
  v
    ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(v))
    : '—';

export function ListsManager({
  initialConfig,
  slots,
}: {
  initialConfig: ListsConfig;
  slots: SlotPlacementRow[];
}): React.JSX.Element {
  const [cfg, setCfg] = useState(initialConfig);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(): Promise<void> {
    setBusy(true);
    setMsg(null);
    try {
      const res = await adminFetch('/admin/api/lists/config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newWindowDays: cfg.newWindowDays }),
      });
      if (res.ok) {
        setCfg((await res.json()).data);
        setMsg('Saved.');
      } else {
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        setMsg(`Save failed: ${j.message ?? res.status}`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gk-cp-page">
      <header className="gk-cp-page-head">
        <h1 className="gk-cp-page-title">Lists &amp; slots</h1>
        <p className="gk-cp-page-sub">
          Homepage sections — order, sizes, rules and pins — are on the{' '}
          <a className="gk-cp-link" href="/admin/homepage">
            Homepage
          </a>{' '}
          screen. Slot records are edited under{' '}
          <a className="gk-cp-link" href="/admin/ad-slots">
            Ad slots
          </a>
          .
        </p>
      </header>

      {msg && <div className="gk-cp-note gk-cp-flash">{msg}</div>}

      <section className="gk-cp-card">
        <h2 className="gk-cp-card-title">“New” window</h2>
        <div className="gk-nl-form">
          <label className="gk-nl-field">
            <span>
              Days back that count as “New”{' '}
              <span className="gk-cp-dim">· /upcoming and the homepage New section</span>
            </span>
            <input
              type="number"
              min={1}
              max={365}
              value={String(cfg.newWindowDays)}
              onChange={(e) => setCfg({ newWindowDays: Number(e.target.value) })}
            />
          </label>
          <div className="gk-nl-actions">
            <button className="gk-cp-btn is-primary" type="button" disabled={busy} onClick={save}>
              Save
            </button>
          </div>
        </div>
      </section>

      <section className="gk-cp-card">
        <div className="gk-cp-card-head">
          <h2 className="gk-cp-card-title">Slot placement</h2>
          <a className="gk-cp-link" href="/admin/ads">
            Advertising →
          </a>
        </div>
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
              {slots.map((s) => (
                <tr key={s.slotKey}>
                  <td>
                    <b>{s.label}</b>
                    <span className="gk-cp-dim"> · {s.slotKey}</span>
                  </td>
                  <td>{s.page}</td>
                  <td>
                    <span className={`gk-adstate is-${s.state}`}>{s.state}</span>
                  </td>
                  <td>{s.placement?.advertiser ?? '—'}</td>
                  <td className="gk-cp-dim">
                    {s.placement
                      ? `${day(s.placement.startsAt)} → ${day(s.placement.endsAt)}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
