'use client';

import { useState } from 'react';
import { adminFetch } from '../_lib/adminFetch';
import type { CommunityKnobs, ReputationKnobs } from '../lib';

/**
 * Community + reputation knobs (Phase P S5 — until now they could only be
 * changed in the database). Validated by the backend (bounds, rising level
 * thresholds), audited per field; a reputation change recomputes levels and
 * badges in the background. Readers never see any of these numbers.
 */
const REACTIONS = ['like', 'insightful', 'funny', 'disagree'] as const;

type NumField<T> = { key: keyof T; label: string; step?: string };
const COMMUNITY_FIELDS: NumField<CommunityKnobs>[] = [
  { key: 'writesPerUser', label: 'Community writes per member per window' },
  { key: 'writeWindowSec', label: 'Write window (seconds)' },
  { key: 'autoHideReports', label: 'Distinct reports that auto-hide a comment' },
];
const REPUTATION_FIELDS: NumField<ReputationKnobs>[] = [
  { key: 'helpfulWeight', label: 'Reputation per credible helpful reaction', step: '0.1' },
  { key: 'reportWeight', label: 'Reputation per accepted report', step: '0.1' },
  { key: 'tenureWeightPerDay', label: 'Reputation per day of membership', step: '0.01' },
  { key: 'tenureCapDays', label: 'Membership days counted (cap)' },
  { key: 'removedPenalty', label: 'Reputation lost per removed comment', step: '0.1' },
  { key: 'earlyVoterVotes', label: 'Votes for the “Early voter” badge' },
];
const LEVELS = ['contributor', 'trusted', 'veteran', 'legend'] as const;

export function CommunityKnobsCard({
  community,
  reputation,
}: {
  community: { values: CommunityKnobs; defaults: CommunityKnobs };
  reputation: { values: ReputationKnobs; defaults: ReputationKnobs };
}): React.JSX.Element {
  const [c, setC] = useState<Record<string, string>>(
    Object.fromEntries(COMMUNITY_FIELDS.map((f) => [f.key, String(community.values[f.key])])),
  );
  const [r, setR] = useState<Record<string, string>>({
    ...Object.fromEntries(REPUTATION_FIELDS.map((f) => [f.key, String(reputation.values[f.key])])),
    ...Object.fromEntries(
      LEVELS.map((l) => [`level.${l}`, String(reputation.values.levelThresholds[l])]),
    ),
  });
  const [reactions, setReactions] = useState<string[]>(reputation.values.positiveReactions);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(path: string, body: unknown): Promise<void> {
    setBusy(true);
    const res = await adminFetch(`/admin/api/${path}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      changed?: string[];
      jobId?: string | null;
      message?: string;
      issues?: { path?: unknown[]; message?: string }[];
    };
    setBusy(false);
    setMsg(
      res.ok
        ? json.changed?.length
          ? `Saved: ${json.changed.join(', ')}${json.jobId ? ` — levels recompute (job ${json.jobId})` : ''}.`
          : 'Nothing changed.'
        : `Not saved: ${json.message ?? json.issues?.map((i) => `${(i.path ?? []).join('.')}: ${i.message}`).join('; ') ?? `HTTP ${res.status}`}`,
    );
  }

  return (
    <section className="gk-cp-card" data-community-knobs>
      <h2 className="gk-cp-card-title">Community &amp; reputation</h2>
      <p className="gk-cp-dim">
        Write limits, auto-hide and how reputation and levels are earned. Defaults in brackets.
        Members never see these numbers.
      </p>
      {msg && <div className="gk-cp-note">{msg}</div>}
      <div className="gk-nl-form">
        {COMMUNITY_FIELDS.map((f) => (
          <label key={String(f.key)} className="gk-nl-field">
            <span>
              {f.label} <span className="gk-cp-dim">[{String(community.defaults[f.key])}]</span>
            </span>
            <input
              inputMode="numeric"
              value={c[f.key as string]}
              onChange={(e) => setC({ ...c, [f.key]: e.target.value })}
            />
          </label>
        ))}
        <div className="gk-nl-actions">
          <button
            className="gk-cp-btn is-primary"
            type="button"
            disabled={busy}
            onClick={() =>
              void save(
                'community-settings',
                Object.fromEntries(
                  COMMUNITY_FIELDS.map((f) => [f.key, Number(c[f.key as string])]),
                ),
              )
            }
          >
            Save community limits
          </button>
        </div>
      </div>
      <div className="gk-nl-form">
        {REPUTATION_FIELDS.map((f) => (
          <label key={String(f.key)} className="gk-nl-field">
            <span>
              {f.label} <span className="gk-cp-dim">[{String(reputation.defaults[f.key])}]</span>
            </span>
            <input
              inputMode="decimal"
              value={r[f.key as string]}
              onChange={(e) => setR({ ...r, [f.key]: e.target.value })}
            />
          </label>
        ))}
        {LEVELS.map((l) => (
          <label key={l} className="gk-nl-field">
            <span>
              Level “{l}” from reputation{' '}
              <span className="gk-cp-dim">[{reputation.defaults.levelThresholds[l]}]</span>
            </span>
            <input
              inputMode="numeric"
              value={r[`level.${l}`]}
              onChange={(e) => setR({ ...r, [`level.${l}`]: e.target.value })}
            />
          </label>
        ))}
        <fieldset className="gk-nl-field">
          <legend>Reactions that count as “helpful”</legend>
          {REACTIONS.map((k) => (
            <label key={k} style={{ marginRight: 12 }}>
              <input
                type="checkbox"
                checked={reactions.includes(k)}
                onChange={(e) =>
                  setReactions(
                    e.target.checked ? [...reactions, k] : reactions.filter((x) => x !== k),
                  )
                }
              />{' '}
              {k}
            </label>
          ))}
        </fieldset>
        <div className="gk-nl-actions">
          <button
            className="gk-cp-btn is-primary"
            type="button"
            disabled={busy}
            onClick={() =>
              void save('reputation-settings', {
                ...Object.fromEntries(
                  REPUTATION_FIELDS.map((f) => [f.key, Number(r[f.key as string])]),
                ),
                positiveReactions: reactions,
                levelThresholds: Object.fromEntries(
                  LEVELS.map((l) => [l, Number(r[`level.${l}`])]),
                ),
              })
            }
          >
            Save reputation rules
          </button>
        </div>
      </div>
    </section>
  );
}
