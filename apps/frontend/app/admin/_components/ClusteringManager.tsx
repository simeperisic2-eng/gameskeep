'use client';

import { useState } from 'react';
import type { ClusterSettings, ClusterTopic } from '../lib';
import { adminFetch } from '../_lib/adminFetch';

interface Props {
  settings: ClusterSettings;
  topics: ClusterTopic[];
}

async function call(
  path: string,
  method: 'POST' | 'PATCH',
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await adminFetch(`/admin/api/${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const json: unknown = await res.json().catch(() => ({}));
    const data = (json ?? {}) as { message?: string };
    if (!res.ok) return { ok: false, message: data.message ?? `HTTP ${res.status}` };
    return { ok: true, message: '✓ done' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

function reloadSoon(): void {
  setTimeout(() => window.location.reload(), 700);
}

export default function ClusteringManager({ settings, topics }: Props) {
  const [threshold, setThreshold] = useState(String(settings.similarityThreshold));
  const [windowDays, setWindowDays] = useState(String(settings.timeWindowDays));
  const [mergeSource, setMergeSource] = useState('');
  const [mergeTarget, setMergeTarget] = useState('');
  const [splitTopic, setSplitTopic] = useState('');
  const [splitArticles, setSplitArticles] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(fn: () => Promise<{ ok: boolean; message: string }>, reload = true) {
    setBusy(true);
    setMsg(null);
    const r = await fn();
    setMsg(r.message);
    setBusy(false);
    if (r.ok && reload) reloadSoon();
  }

  const splitTopicObj = topics.find((t) => t.id === splitTopic);
  const topicOptions = topics.map((t) => ({
    id: t.id,
    label: `${t.title.slice(0, 60)} (${t.articleCount})`,
  }));

  return (
    <div>
      {/* Tune + ingest */}
      <section className="gk-card" style={{ marginBottom: 18 }}>
        <h2 className="gk-card-title">Tune &amp; run</h2>
        <p className="gk-sub">
          Threshold is cosine similarity (0–1): higher = more, smaller topics; lower = fewer,
          broader topics. Re-cluster from feed to see the effect.
        </p>
        <div className="gk-rel-row">
          <label>
            Similarity threshold{' '}
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              style={{ width: 90 }}
            />
          </label>
          <label>
            Time window (days){' '}
            <input
              type="number"
              min="1"
              max="365"
              value={windowDays}
              onChange={(e) => setWindowDays(e.target.value)}
              style={{ width: 80 }}
            />
          </label>
          <button
            className="gk-btn gk-btn-sm gk-btn-primary"
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  call('clustering/settings', 'PATCH', {
                    similarityThreshold: Number(threshold),
                    timeWindowDays: Number(windowDays),
                  }),
                false,
              )
            }
          >
            Save settings
          </button>
        </div>
        <div className="gk-rel-row" style={{ marginTop: 10 }}>
          <button
            className="gk-btn gk-btn-sm"
            disabled={busy}
            onClick={() => run(() => call('clustering/ingest', 'POST', {}), false)}
          >
            Run ingest (new items)
          </button>
          <button
            className="gk-btn gk-btn-sm gk-btn-danger"
            disabled={busy}
            onClick={() => run(() => call('clustering/ingest', 'POST', { reset: true }), false)}
          >
            Re-cluster from feed (reset)
          </button>
          <span className="gk-sub">Runs in the background — refresh to see results.</span>
        </div>
      </section>

      {/* Merge */}
      <section className="gk-card" style={{ marginBottom: 18 }}>
        <h2 className="gk-card-title">Merge topics</h2>
        <p className="gk-sub">Combine two topics the engine wrongly split. Source is absorbed.</p>
        <div className="gk-rel-row">
          <select value={mergeSource} onChange={(e) => setMergeSource(e.target.value)}>
            <option value="">source topic…</option>
            {topicOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <span>→</span>
          <select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
            <option value="">target topic…</option>
            {topicOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <button
            className="gk-btn gk-btn-sm"
            disabled={busy || !mergeSource || !mergeTarget || mergeSource === mergeTarget}
            onClick={() =>
              run(() =>
                call('clustering/merge', 'POST', {
                  sourceTopicId: mergeSource,
                  targetTopicId: mergeTarget,
                }),
              )
            }
          >
            Merge
          </button>
        </div>
      </section>

      {/* Split */}
      <section className="gk-card" style={{ marginBottom: 18 }}>
        <h2 className="gk-card-title">Split a topic</h2>
        <p className="gk-sub">Move selected articles out into a new topic (wrongly lumped).</p>
        <div className="gk-rel-row">
          <select
            value={splitTopic}
            onChange={(e) => {
              setSplitTopic(e.target.value);
              setSplitArticles({});
            }}
          >
            <option value="">pick a topic…</option>
            {topicOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <button
            className="gk-btn gk-btn-sm"
            disabled={busy || Object.values(splitArticles).every((v) => !v)}
            onClick={() =>
              run(() =>
                call('clustering/split', 'POST', {
                  topicId: splitTopic,
                  articleIds: Object.entries(splitArticles)
                    .filter(([, v]) => v)
                    .map(([k]) => k),
                }),
              )
            }
          >
            Split selected
          </button>
        </div>
        {splitTopicObj ? (
          <ul style={{ marginTop: 10, listStyle: 'none', padding: 0 }}>
            {splitTopicObj.articles.map((a) => (
              <li key={a.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(splitArticles[a.id])}
                    onChange={(e) =>
                      setSplitArticles((prev) => ({ ...prev, [a.id]: e.target.checked }))
                    }
                  />{' '}
                  [{a.sourceSlug ?? '—'}] {a.title}
                  {a.isPrimary ? ' ★' : ''}
                </label>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {msg ? (
        <p className="gk-rel-msg" style={{ display: 'block', marginBottom: 12 }}>
          {msg}
        </p>
      ) : null}

      {/* Topics overview */}
      <section className="gk-card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="gk-table">
          <thead>
            <tr>
              <th>Topic</th>
              <th>Status</th>
              <th>Articles</th>
              <th>Sources</th>
              <th>TL;DR (AI)</th>
            </tr>
          </thead>
          <tbody>
            {topics.map((t) => (
              <tr key={t.id}>
                <td>
                  <strong>{t.title}</strong>
                </td>
                <td>{t.status}</td>
                <td>{t.articleCount}</td>
                <td>{t.sources.join(', ') || '—'}</td>
                <td>{t.tldr ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
