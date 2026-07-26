'use client';

import { useState } from 'react';
import type { AdminArticleBias, BiasBreakdown, BiasStatus, TopicBiasView } from '../lib';

interface Props {
  status: BiasStatus;
  articles: AdminArticleBias[];
  topics: TopicBiasView[];
}

async function call(
  path: string,
  method: 'POST' | 'PATCH',
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`/admin/api/${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const json: unknown = await res.json().catch(() => ({}));
    const data = (json ?? {}) as { message?: string };
    if (!res.ok) return { ok: false, message: data.message ?? `HTTP ${res.status}` };
    return { ok: true, message: '✓ done — recompute runs in the background, refresh shortly' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

function reloadSoon(): void {
  setTimeout(() => window.location.reload(), 1200);
}

function Breakdown({ b }: { b: BiasBreakdown | null }) {
  if (!b) return <span className="gk-sub">—</span>;
  return (
    <ul style={{ margin: 0, paddingLeft: 16 }}>
      {b.contributions.map((c, i) => (
        <li key={i} className="gk-sub">
          {c.label}: {c.points > 0 ? '+' : ''}
          {c.points}
        </li>
      ))}
      <li>
        <strong>= {b.score}</strong> (raw {b.rawSum})
      </li>
    </ul>
  );
}

export default function BiasManager({ status, articles, topics }: Props) {
  const [weights, setWeights] = useState(status.weights);
  const [gate, setGate] = useState(status.gate);
  const [selectedId, setSelectedId] = useState(articles[0]?.id ?? '');
  const [ovInfluence, setOvInfluence] = useState('');
  const [ovQuality, setOvQuality] = useState('');
  const [ovReason, setOvReason] = useState('');
  const [note, setNote] = useState('');
  const [internal, setInternal] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const selected = articles.find((a) => a.id === selectedId);

  async function run(fn: () => Promise<{ ok: boolean; message: string }>) {
    setBusy(true);
    setMsg(null);
    const r = await fn();
    setMsg(r.message);
    setBusy(false);
    if (r.ok) reloadSoon();
  }

  function setWeight(group: 'influence' | 'quality', key: string, value: string) {
    setWeights((w) => ({ ...w, [group]: { ...w[group], [key]: Number(value) } }));
  }

  return (
    <div>
      {/* Weights */}
      <section className="gk-card" style={{ marginBottom: 18 }}>
        <h2 className="gk-card-title">Weights (transparent + tunable)</h2>
        <p className="gk-sub">
          Every point on a score comes from one of these named weights — no black box. Saving
          re-tunes the AUTO scores on the next recompute; editor overrides are never clobbered.
        </p>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
          <div>
            <strong className="gk-sub">Influence (0=independent → 100=influenced)</strong>
            {Object.entries(weights.influence).map(([k, v]) => (
              <div key={k} style={{ marginTop: 4 }}>
                <label className="gk-sub">
                  {k}{' '}
                  <input
                    type="number"
                    value={v}
                    onChange={(e) => setWeight('influence', k, e.target.value)}
                    style={{ width: 70 }}
                  />
                </label>
              </div>
            ))}
          </div>
          <div>
            <strong className="gk-sub">Quality (0=slop → 100=top)</strong>
            {Object.entries(weights.quality).map(([k, v]) => (
              <div key={k} style={{ marginTop: 4 }}>
                <label className="gk-sub">
                  {k}{' '}
                  <input
                    type="number"
                    value={v}
                    onChange={(e) => setWeight('quality', k, e.target.value)}
                    style={{ width: 70 }}
                  />
                </label>
              </div>
            ))}
          </div>
        </div>
        <div className="gk-rel-row" style={{ marginTop: 12 }}>
          <button
            className="gk-btn gk-btn-sm gk-btn-primary"
            disabled={busy}
            onClick={() =>
              run(() =>
                call('bias/weights', 'PATCH', {
                  influence: weights.influence,
                  quality: weights.quality,
                }),
              )
            }
          >
            Save weights + recompute
          </button>
          <button
            className="gk-btn gk-btn-sm"
            disabled={busy}
            onClick={() => run(() => call('bias/recompute', 'POST', {}))}
          >
            Recompute now
          </button>
        </div>
      </section>

      {/* Secondary gate */}
      <section className="gk-card" style={{ marginBottom: 18 }}>
        <h2 className="gk-card-title">Clustering secondary gate</h2>
        <p className="gk-sub">
          Resists same-game / different-event over-merges: same primary game + a different event
          kind + the candidate topic at least N days older → keep them separate. Only resists
          merges; editor merge/split still overrides.
        </p>
        <div className="gk-rel-row">
          <label className="gk-sub">
            <input
              type="checkbox"
              checked={gate.enabled}
              onChange={(e) => setGate((g) => ({ ...g, enabled: e.target.checked }))}
            />{' '}
            enabled
          </label>
          <label className="gk-sub">
            min event gap (days){' '}
            <input
              type="number"
              step="0.5"
              min="0"
              value={gate.minEventGapDays}
              onChange={(e) => setGate((g) => ({ ...g, minEventGapDays: Number(e.target.value) }))}
              style={{ width: 70 }}
            />
          </label>
          <label className="gk-sub">
            <input
              type="checkbox"
              checked={gate.requireDifferentEventKind}
              onChange={(e) =>
                setGate((g) => ({ ...g, requireDifferentEventKind: e.target.checked }))
              }
            />{' '}
            require different event kind
          </label>
          <button
            className="gk-btn gk-btn-sm gk-btn-primary"
            disabled={busy}
            onClick={() => run(() => call('clustering/settings', 'PATCH', { gate }))}
          >
            Save gate
          </button>
        </div>
        <p className="gk-sub" style={{ marginTop: 8 }}>
          Re-cluster from the Clustering page to apply the gate to existing topics.
        </p>
      </section>

      {/* Per-article editor */}
      <section className="gk-card" style={{ marginBottom: 18 }}>
        <h2 className="gk-card-title">Inspect &amp; override an article</h2>
        <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
          <option value="">pick an article…</option>
          {articles.map((a) => (
            <option key={a.id} value={a.id}>
              [{a.influence.effective ?? '—'}/{a.quality.effective ?? '—'}] {a.title.slice(0, 70)}
            </option>
          ))}
        </select>
        {selected ? (
          <div style={{ marginTop: 12 }}>
            <p className="gk-sub">
              <strong>{selected.title}</strong> · {selected.sourceSlug ?? '—'} ·{' '}
              {selected.articleType} · event: {selected.eventKind ?? 'other'}
            </p>
            <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
              <div>
                <strong className="gk-sub">
                  Influence: {selected.influence.effective ?? '—'}
                  {selected.influence.override != null ? ' (editor-set)' : ' (auto)'}
                </strong>
                <Breakdown b={selected.influenceBreakdown} />
              </div>
              <div>
                <strong className="gk-sub">
                  Quality: {selected.quality.effective ?? '—'}
                  {selected.quality.override != null ? ' (editor-set)' : ' (auto)'}
                </strong>
                <Breakdown b={selected.qualityBreakdown} />
              </div>
            </div>

            <div className="gk-rel-row" style={{ marginTop: 12 }}>
              <label className="gk-sub">
                influence override{' '}
                <input
                  type="number"
                  min="0"
                  max="100"
                  placeholder={String(selected.influence.auto ?? '')}
                  value={ovInfluence}
                  onChange={(e) => setOvInfluence(e.target.value)}
                  style={{ width: 70 }}
                />
              </label>
              <label className="gk-sub">
                quality override{' '}
                <input
                  type="number"
                  min="0"
                  max="100"
                  placeholder={String(selected.quality.auto ?? '')}
                  value={ovQuality}
                  onChange={(e) => setOvQuality(e.target.value)}
                  style={{ width: 70 }}
                />
              </label>
              <input
                type="text"
                placeholder="reason (audit-logged)"
                value={ovReason}
                onChange={(e) => setOvReason(e.target.value)}
                style={{ width: 220 }}
              />
              <button
                className="gk-btn gk-btn-sm"
                disabled={busy || (!ovInfluence && !ovQuality)}
                onClick={() =>
                  run(() =>
                    call(`bias/article/${selected.id}/override`, 'POST', {
                      ...(ovInfluence ? { influenceScore: Number(ovInfluence) } : {}),
                      ...(ovQuality ? { qualityScore: Number(ovQuality) } : {}),
                      reason: ovReason || 'editor override',
                    }),
                  )
                }
              >
                Override
              </button>
              <button
                className="gk-btn gk-btn-sm"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    call(`bias/article/${selected.id}/override`, 'POST', {
                      influenceScore: null,
                      qualityScore: null,
                    }),
                  )
                }
              >
                Clear overrides
              </button>
            </div>

            <div className="gk-rel-row" style={{ marginTop: 10 }}>
              <input
                type="text"
                placeholder={selected.editorNote ?? 'judgmental note (editor-written, public)'}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                style={{ width: 360 }}
              />
              <button
                className="gk-btn gk-btn-sm"
                disabled={busy || !note}
                onClick={() =>
                  run(() => call(`bias/article/${selected.id}/note`, 'POST', { editorNote: note }))
                }
              >
                Save note
              </button>
            </div>

            <div className="gk-rel-row" style={{ marginTop: 10 }}>
              <input
                type="text"
                placeholder={selected.internalAssessment ?? 'INTERNAL ONLY — never shown publicly'}
                value={internal}
                onChange={(e) => setInternal(e.target.value)}
                style={{ width: 360 }}
              />
              <button
                className="gk-btn gk-btn-sm gk-btn-danger"
                disabled={busy || !internal}
                onClick={() =>
                  run(() =>
                    call(`bias/article/${selected.id}/internal`, 'POST', {
                      internalAssessment: internal,
                    }),
                  )
                }
              >
                Save internal (walled)
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {msg ? (
        <p className="gk-rel-msg" style={{ display: 'block', marginBottom: 12 }}>
          {msg}
        </p>
      ) : null}

      {/* Articles overview */}
      <section className="gk-card" style={{ padding: 0, overflowX: 'auto', marginBottom: 18 }}>
        <table className="gk-table">
          <thead>
            <tr>
              <th>Article</th>
              <th>Source</th>
              <th>Influence</th>
              <th>Quality</th>
              <th>Event</th>
              <th>Signals</th>
            </tr>
          </thead>
          <tbody>
            {articles.slice(0, 200).map((a) => (
              <tr key={a.id}>
                <td>{a.title.slice(0, 70)}</td>
                <td>{a.sourceSlug ?? '—'}</td>
                <td>
                  {a.influence.effective ?? '—'}
                  {a.influence.override != null ? ' ✎' : ''}
                </td>
                <td>
                  {a.quality.effective ?? '—'}
                  {a.quality.override != null ? ' ✎' : ''}
                </td>
                <td>{a.eventKind ?? 'other'}</td>
                <td className="gk-sub">
                  {[
                    a.signals.isSponsored ? 'sponsored' : null,
                    a.signals.hasAffiliateLinks ? 'affiliate' : null,
                    a.signals.basedOnReviewCopy ? 'review-copy' : null,
                    a.signals.isPaywalled ? 'paywall' : null,
                  ]
                    .filter(Boolean)
                    .join(', ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Topic distributions */}
      <section className="gk-card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="gk-table">
          <thead>
            <tr>
              <th>Topic</th>
              <th>Articles</th>
              <th>Influence (ind / inf)</th>
              <th>Quality (top / slop)</th>
            </tr>
          </thead>
          <tbody>
            {topics.slice(0, 120).map((t) => (
              <tr key={t.id}>
                <td>{t.title.slice(0, 70)}</td>
                <td>{t.articleCount}</td>
                <td>
                  {t.distribution?.influence.independent ?? 0} /{' '}
                  {t.distribution?.influence.influenced ?? 0}
                </td>
                <td>
                  {t.distribution?.quality.top ?? 0} / {t.distribution?.quality.slop ?? 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
