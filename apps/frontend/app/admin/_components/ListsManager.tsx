'use client';

import { useState } from 'react';
import { adminFetch } from '../_lib/adminFetch';
import type { ListsConfig, ListsPreview, SlotPlacementRow } from '../lib';

/**
 * List / slot configuration (SPEC I8, Slice 4). Admin arranges the homepage
 * rails (sizes + manual pins, all in `app_settings.lists`) and reviews slot
 * placement. AUTO + MANUAL OVERRIDE: the rails still compute automatically; pins
 * float on top. Nothing is hardcoded. Every save is audited server-side.
 */

const day = (v: string | null): string =>
  v
    ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(v))
    : '—';

export function ListsManager({
  initialConfig,
  promotedGameSlugs,
  initialPreview,
  slots,
}: {
  initialConfig: ListsConfig;
  promotedGameSlugs: string[];
  initialPreview: ListsPreview;
  slots: SlotPlacementRow[];
}): React.JSX.Element {
  const [cfg, setCfg] = useState(initialConfig);
  const [preview, setPreview] = useState(initialPreview);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const num = (k: keyof ListsConfig, v: string): void => setCfg((c) => ({ ...c, [k]: Number(v) }));
  const slugs = (k: 'pinnedTopicSlugs' | 'pinnedGameSlugs', v: string): void =>
    setCfg((c) => ({
      ...c,
      [k]: v
        .split(/[\s,]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    }));

  async function save(): Promise<void> {
    setBusy(true);
    setMsg(null);
    try {
      const res = await adminFetch('/admin/api/lists/config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      if (res.ok) {
        setCfg((await res.json()).data);
        const pv = await adminFetch('/admin/api/lists/preview');
        if (pv.ok) setPreview((await pv.json()).data);
        setMsg('Saved. The homepage will use this on its next render.');
      } else {
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        setMsg(`Save failed: ${j.message ?? res.status}`);
      }
    } finally {
      setBusy(false);
    }
  }

  const NumberField = ({
    k,
    label,
    hint,
  }: {
    k: keyof ListsConfig;
    label: string;
    hint: string;
  }): React.JSX.Element => (
    <label className="gk-nl-field">
      <span>
        {label} <span className="gk-cp-dim">· {hint}</span>
      </span>
      <input
        type="number"
        min={1}
        value={String(cfg[k] as number)}
        onChange={(e) => num(k, e.target.value)}
      />
    </label>
  );

  return (
    <div className="gk-cp-page">
      <header className="gk-cp-page-head">
        <h1 className="gk-cp-page-title">Lists &amp; slots</h1>
        <p className="gk-cp-page-sub">
          Arrange the homepage rails and pins — all stored in settings, nothing hardcoded. The rails
          still rank automatically; <b>pins float on top</b> (manual override). Slot records are
          edited under{' '}
          <a className="gk-cp-link" href="/admin/ad-slots">
            Ad slots
          </a>
          .
        </p>
      </header>

      {msg && <div className="gk-cp-note gk-cp-flash">{msg}</div>}

      <section className="gk-cp-card">
        <h2 className="gk-cp-card-title">Rail sizes</h2>
        <div className="gk-nl-form">
          <NumberField k="heroCount" label="Hero stories" hint="front-page spotlight" />
          <NumberField k="feedCount" label="Main feed" hint="the rest, newest first" />
          <NumberField k="topRatedCount" label="Top rated games" hint="ranking rail" />
          <NumberField k="focusCount" label="Games in focus" hint="biggest disconnect" />
          <NumberField
            k="newWindowDays"
            label="“New” window (days)"
            hint="Upcoming → recently released"
          />
        </div>
      </section>

      <section className="gk-cp-card">
        <h2 className="gk-cp-card-title">Pins &amp; featured (manual override)</h2>
        <div className="gk-nl-form">
          <label className="gk-nl-field gk-nl-field-wide">
            <span>
              Pinned story slugs <span className="gk-cp-dim">· float to the front of the hero</span>
            </span>
            <input
              value={cfg.pinnedTopicSlugs.join(', ')}
              placeholder="e.g. silksong-release-date, gta-6-trailer"
              onChange={(e) => slugs('pinnedTopicSlugs', e.target.value)}
            />
          </label>
          <label className="gk-nl-field gk-nl-field-wide">
            <span>
              Pinned game slugs <span className="gk-cp-dim">· float to the front of Top Rated</span>
            </span>
            <input
              value={cfg.pinnedGameSlugs.join(', ')}
              placeholder="e.g. cyberpunk-2077, baldurs-gate-3"
              onChange={(e) => slugs('pinnedGameSlugs', e.target.value)}
            />
          </label>
          <label className="gk-nl-check gk-nl-field-wide">
            <input
              type="checkbox"
              checked={cfg.pinPromotedGames}
              onChange={(e) => setCfg((c) => ({ ...c, pinPromotedGames: e.target.checked }))}
            />
            <span>
              Auto-surface <b>promoted</b> games at the front of Top Rated{' '}
              <span className="gk-cp-dim">
                (auto default — a manual pin still wins).{' '}
                {promotedGameSlugs.length > 0
                  ? `Currently promoted: ${promotedGameSlugs.join(', ')}`
                  : 'No active game promotions right now.'}
              </span>
            </span>
          </label>
          <div className="gk-nl-actions">
            <button className="gk-cp-btn is-primary" type="button" disabled={busy} onClick={save}>
              Save configuration
            </button>
          </div>
        </div>
      </section>

      <section className="gk-cp-card">
        <h2 className="gk-cp-card-title">Live preview · what the homepage will render</h2>
        <div className="gk-lists-preview">
          <div>
            <h3 className="gk-lists-preview-h">Hero ({preview.hero.length})</h3>
            <ol className="gk-lists-preview-list">
              {preview.hero.map((c) => (
                <li key={c.slug}>{c.title}</li>
              ))}
            </ol>
          </div>
          <div>
            <h3 className="gk-lists-preview-h">Top rated ({preview.topRated.length})</h3>
            <ol className="gk-lists-preview-list">
              {preview.topRated.map((g) => (
                <li key={g.slug}>
                  {g.name}
                  {cfg.pinnedGameSlugs.includes(g.slug) || promotedGameSlugs.includes(g.slug) ? (
                    <span className="gk-lists-pin">pinned</span>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h3 className="gk-lists-preview-h">In focus ({preview.controversial.length})</h3>
            <ol className="gk-lists-preview-list">
              {preview.controversial.map((g) => (
                <li key={g.slug}>{g.name}</li>
              ))}
            </ol>
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
