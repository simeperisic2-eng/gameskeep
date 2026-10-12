'use client';

import { useState } from 'react';
import { adminFetch } from '../_lib/adminFetch';
import type { SuggestLimits } from '../lib';

/**
 * Rate limits of the public "Suggest a missing game" form (S2 review: moved from
 * code into app_settings `suggest`). Admin-only on the server; every save is
 * audited (old → new per key) and applies to the next suggestion.
 */
export function SuggestLimitsCard({ initial }: { initial: SuggestLimits }): React.JSX.Element {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(): Promise<void> {
    setBusy(true);
    setMsg(null);
    try {
      const res = await adminFetch('/admin/api/catalog/suggest-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(v),
      });
      const j = (await res.json().catch(() => ({}))) as {
        data?: SuggestLimits;
        message?: string;
        issues?: { message?: string }[];
      };
      if (res.ok && j.data) {
        setV(j.data);
        setMsg('Saved — applies to the next suggestion.');
      } else {
        setMsg(
          `Save failed: ${j.message ?? j.issues?.map((i) => i.message).join('; ') ?? `HTTP ${res.status}`}`,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  const num = (k: keyof SuggestLimits, label: string, min: number, max: number) => (
    <label className="gk-nl-field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={String(v[k])}
        onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })}
      />
    </label>
  );

  return (
    <section className="gk-cp-card" aria-label="Suggestion limits">
      <h2 className="gk-cp-card-title">Public suggestions — rate limits</h2>
      <p className="gk-cp-dim">
        How many “Suggest a missing game” submissions are accepted per window. Suggestions only ever
        land in this queue — nothing publishes without an editor.
      </p>
      <div className="gk-nl-form">
        {num('perIpMax', 'Per IP', 1, 1000)}
        {num('globalMax', 'Overall', 1, 100000)}
        {num('windowMinutes', 'Window (minutes)', 1, 1440)}
        <div className="gk-nl-actions">
          <button className="gk-cp-btn is-primary" type="button" disabled={busy} onClick={save}>
            Save limits
          </button>
          {msg ? <span className="gk-cp-dim">{msg}</span> : null}
        </div>
      </div>
    </section>
  );
}
