'use client';

import { useState } from 'react';
import { adminFetch } from '../_lib/adminFetch';
import type { CriticFeedData, CriticFeedItem } from '../lib';

/**
 * "Score this review" (Phase P S5, moderator+) — ingested outlet reviews without
 * a critic score. A score pattern in the title / excerpt ("9/10", "4.5 stars",
 * "92/100") is only a SUGGESTION: you confirm (or change) it; nothing
 * auto-publishes. Confirming adds a critic review (once per article, audited)
 * and recomputes the game's ratings in the background. "Not a scored review"
 * takes it off the list (undo below).
 */
async function call(
  path: string,
  body: unknown,
): Promise<{ ok: boolean; json: Record<string, unknown> }> {
  const res = await adminFetch(`/admin/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok && !json.message) {
    const issues = json.issues as { message?: string }[] | undefined;
    json.message = issues?.map((i) => i.message).join('; ') || `HTTP ${res.status}`;
  }
  return { ok: res.ok, json };
}

function Row({
  item,
  onDone,
}: {
  item: CriticFeedItem;
  onDone: (msg: string, ok: boolean) => void;
}): React.JSX.Element {
  const [score, setScore] = useState(item.suggestion ? String(item.suggestion.nativeScore) : '');
  const [scale, setScale] = useState(item.suggestion ? String(item.suggestion.scaleMax) : '10');
  const [busy, setBusy] = useState(false);
  const n = Number(score);
  const max = Number(scale);
  const valid =
    score.trim() !== '' &&
    Number.isFinite(n) &&
    n >= 0 &&
    Number.isFinite(max) &&
    max >= 1 &&
    n <= max;
  return (
    <tr data-feed-item={item.guid}>
      <td>
        <b>{item.outlet.name}</b> — {item.title}{' '}
        <span className="gk-cp-dim">
          · {item.game.name} · {item.reviewDate ?? 'no date'}
        </span>
        {item.excerpt ? <div className="gk-cp-dim">{item.excerpt}</div> : null}
        {item.suggestion ? (
          <div className="gk-cp-dim">
            Suggested from “{item.suggestion.match}”: {item.suggestion.nativeScore}/
            {item.suggestion.scaleMax} → {item.suggestion.normalized}/100 (confirm or change)
          </div>
        ) : (
          <div className="gk-cp-dim">No score found in the text — enter it from the review.</div>
        )}
        {item.url ? (
          <a className="gk-cp-link" href={item.url} target="_blank" rel="noopener noreferrer">
            Open the review ↗
          </a>
        ) : null}
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <input
          aria-label="Score"
          style={{ width: 64 }}
          inputMode="decimal"
          value={score}
          onChange={(e) => setScore(e.target.value)}
        />{' '}
        /{' '}
        <select aria-label="Scale" value={scale} onChange={(e) => setScale(e.target.value)}>
          {['5', '10', '100'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>{' '}
        <button
          className="gk-cp-btn is-small is-primary"
          type="button"
          disabled={busy || !valid}
          onClick={async () => {
            setBusy(true);
            const r = await call('critic-feed/score', {
              guid: item.guid,
              nativeScore: n,
              scaleMax: max,
            });
            setBusy(false);
            onDone(
              r.ok
                ? `Scored ${item.outlet.name} → ${item.game.name}: ${n}/${max} (ratings recompute, job ${String(r.json.jobId ?? '—')}).`
                : `Not scored: ${String(r.json.message)}`,
              r.ok,
            );
          }}
        >
          Confirm score
        </button>{' '}
        <button
          className="gk-cp-btn is-small"
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await call('critic-feed/dismiss', { guid: item.guid });
            setBusy(false);
            onDone(
              r.ok ? 'Marked “not a scored review”.' : `Failed: ${String(r.json.message)}`,
              r.ok,
            );
          }}
        >
          Not a scored review
        </button>
      </td>
    </tr>
  );
}

export function CriticFeedManager({ initial }: { initial: CriticFeedData }): React.JSX.Element {
  const [data, setData] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);

  async function reload(): Promise<void> {
    const res = await adminFetch('/admin/api/critic-feed');
    const json = (await res.json().catch(() => ({}))) as { data?: CriticFeedData };
    if (res.ok && json.data) setData(json.data);
  }
  const done = (m: string, ok: boolean): void => {
    setMsg(m);
    if (ok) void reload();
  };

  return (
    <div className="gk-cp-page">
      <header className="gk-cp-page-head">
        <h1 className="gk-cp-page-title">Score this review</h1>
        <p className="gk-cp-page-sub">
          Outlet reviews we ingested that have no critic score yet. A score found in the text is a
          suggestion — you confirm it. Scale rules: Rules &amp; limits → Critic feed. External
          source: {data.provider.description}
        </p>
      </header>
      {msg && <div className="gk-cp-note gk-cp-flash">{msg}</div>}
      <section className="gk-cp-card">
        <h2 className="gk-cp-card-title">Waiting ({data.queue.length})</h2>
        {data.queue.length === 0 ? (
          <p className="gk-cp-dim">Nothing to score.</p>
        ) : (
          <table className="gk-cp-table" data-critic-feed>
            <tbody>
              {data.queue.map((item) => (
                <Row key={item.guid} item={item} onDone={done} />
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="gk-cp-card">
        <details>
          <summary className="gk-cp-dim">
            Marked “not a scored review” ({data.dismissed.length})
          </summary>
          <table className="gk-cp-table">
            <tbody>
              {data.dismissed.map((d) => (
                <tr key={d.guid}>
                  <td>
                    <code>{d.guid}</code>{' '}
                    <span className="gk-cp-dim">
                      · {d.decidedBy ?? '—'} · {d.decidedAt.slice(0, 10)}
                    </span>
                  </td>
                  <td>
                    <button
                      className="gk-cp-btn is-small"
                      type="button"
                      onClick={async () => {
                        const r = await call('critic-feed/restore', { guid: d.guid });
                        done(
                          r.ok ? 'Back in the queue.' : `Failed: ${String(r.json.message)}`,
                          r.ok,
                        );
                      }}
                    >
                      Undo
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>
    </div>
  );
}
