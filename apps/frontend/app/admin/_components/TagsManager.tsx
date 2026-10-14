'use client';

import { useState } from 'react';
import { adminFetch } from '../_lib/adminFetch';
import type { TagQueue, TagQueueRow, TagSettingsConfig } from '../lib';

/**
 * Tag moderation (Phase P S3). Editors (moderator+) confirm player reports that
 * reached the threshold, publish tags directly ("Added by editors"), remove
 * (a tombstone imports and votes can't undo), re-confirm / resolve issues with a
 * patch reference, and decide suggested names. The ANOMALY FLAG is always shown
 * here, whatever the public setting (owner). Every action is audited server-side.
 */
const day = (v: string | null): string =>
  v
    ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(v))
    : '—';

async function post(
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; message: string; jobId?: string | null }> {
  const res = await adminFetch(`/admin/api/${path}`, {
    method: 'POST',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const j = (await res.json().catch(() => ({}))) as {
    message?: string;
    issues?: { message?: string }[];
    jobId?: string | null;
  };
  return {
    ok: res.ok,
    jobId: j.jobId ?? null,
    message: res.ok
      ? 'Saved.'
      : (j.message ?? j.issues?.map((i) => i.message).join('; ') ?? `HTTP ${res.status}`),
  };
}

function Flag({ row }: { row: TagQueueRow }): React.JSX.Element | null {
  if (!row.flagged) return null;
  const f = row.flagInfo ?? {};
  return (
    <span
      className="gk-adstate is-flagged"
      title="Vote spike made mostly of low-credibility accounts"
    >
      ⚠ unusual voting · {f.windowCount ?? '?'} in window, {Math.round((f.lowShare ?? 0) * 100)}%
      low-credibility
    </span>
  );
}

export function TagsManager({
  initial,
  settings,
}: {
  initial: TagQueue;
  settings: TagSettingsConfig | null;
}): React.JSX.Element {
  const [q, setQ] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [patch, setPatch] = useState<Record<string, string>>({});
  const [direct, setDirect] = useState({ gameSlug: '', tagSlug: '' });
  const [familyOf, setFamilyOf] = useState<Record<string, 'content' | 'issue'>>({});
  const [mergeInto, setMergeInto] = useState<Record<string, string>>({});
  const [s, setS] = useState(settings);

  async function reload(): Promise<void> {
    const res = await adminFetch('/admin/api/tag-queue');
    if (res.ok) setQ(((await res.json()) as { data: TagQueue }).data);
  }
  async function run(path: string, body?: unknown): Promise<void> {
    setBusy(true);
    const r = await post(path, body);
    setBusy(false);
    setMsg(r.message);
    if (r.ok) await reload();
  }
  /** Phase P S3b: import mapping runs as a background job — wait for YOUR run. */
  async function runSync(): Promise<void> {
    setBusy(true);
    const r = await post('tag-queue/sync');
    if (!r.ok || !r.jobId) {
      setBusy(false);
      setMsg(r.ok ? 'Import mapping queued.' : r.message);
      return;
    }
    setMsg(`Import mapping running in the background (job ${r.jobId})…`);
    for (let i = 0; i < 60; i += 1) {
      await new Promise((ok) => setTimeout(ok, 1000));
      const res = await adminFetch(`/admin/api/jobs/tags/${encodeURIComponent(r.jobId)}`);
      if (res.status === 403) {
        // Job state is an admin view; a moderator just refreshes the queue shortly.
        setMsg(`Import mapping queued (job ${r.jobId}) — the queue refreshes in a moment.`);
        await new Promise((ok) => setTimeout(ok, 3000));
        await reload();
        setBusy(false);
        return;
      }
      if (!res.ok) continue;
      const j =
        (
          (await res.json().catch(() => ({}))) as {
            data?: {
              state?: string;
              result?: { mapped?: number; queued?: number; payToWin?: number } | null;
            };
          }
        ).data ?? {};
      if (j.state === 'completed') {
        const x = j.result ?? {};
        setMsg(
          `Import mapping done (job ${r.jobId}): ${x.mapped ?? 0} mapped, ${x.queued ?? 0} queued as suggestions, ${x.payToWin ?? 0} legacy pay-to-win migrated.`,
        );
        await reload();
        setBusy(false);
        return;
      }
      if (j.state === 'failed') {
        setMsg(`Import mapping failed (job ${r.jobId}).`);
        setBusy(false);
        return;
      }
    }
    setMsg(`Import mapping still running (job ${r.jobId}) — reload later.`);
    setBusy(false);
  }
  async function saveSettings(): Promise<void> {
    if (!s) return;
    setBusy(true);
    const res = await adminFetch('/admin/api/tag-settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(s),
    });
    setBusy(false);
    const j = (await res.json().catch(() => ({}))) as {
      data?: TagSettingsConfig;
      message?: string;
      issues?: { message?: string }[];
    };
    if (res.ok && j.data) {
      setS(j.data);
      setMsg('Tag settings saved.');
    } else {
      setMsg(
        `Settings not saved: ${j.message ?? j.issues?.map((i) => i.message).join('; ') ?? res.status}`,
      );
    }
  }

  const num = (k: keyof TagSettingsConfig, label: string, step = 1): React.JSX.Element | null =>
    s ? (
      <label className="gk-nl-field">
        <span>{label}</span>
        <input
          type="number"
          step={step}
          value={String(s[k])}
          onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })}
        />
      </label>
    ) : null;

  return (
    <div className="gk-cp-page">
      <header className="gk-cp-page-head">
        <h1 className="gk-cp-page-title">Tags</h1>
        <p className="gk-cp-page-sub">
          A player-reported tag goes public when its credibility-weighted score reaches{' '}
          <b>{q.threshold}</b> and an editor confirms it. Editors can also publish a tag directly.
          The taxonomy itself is edited under{' '}
          <a className="gk-cp-link" href="/admin/tag-taxonomy">
            Tag taxonomy
          </a>
          .
        </p>
        {msg ? (
          <p className="gk-cp-dim" role="status">
            {msg}
          </p>
        ) : null}
      </header>

      <section className="gk-cp-card">
        <h2 className="gk-cp-card-title">Waiting for review ({q.pending.length})</h2>
        {q.pending.length === 0 ? (
          <p className="gk-cp-dim">Nothing waiting.</p>
        ) : (
          <table className="gk-cp-table">
            <tbody>
              {q.pending.map((r) => (
                <tr key={r.id}>
                  <td>
                    <b>{r.tag.name}</b> <span className="gk-cp-dim">({r.tag.family})</span> on{' '}
                    <a className="gk-cp-link" href={`/games/${r.game.slug}`}>
                      {r.game.name}
                    </a>
                    <div className="gk-cp-dim">
                      score {r.weightedScore} / {q.threshold} · {r.voteCount}{' '}
                      {r.voteCount === 1 ? 'vote' : 'votes'} · first seen {day(r.firstSeenAt)}
                      {r.thresholdReached ? ' · threshold reached' : ' · below the threshold'}
                    </div>
                    <Flag row={r} />
                  </td>
                  <td>
                    <button
                      className="gk-cp-btn is-small is-primary"
                      type="button"
                      disabled={busy || !r.thresholdReached}
                      title={r.thresholdReached ? 'Publish' : 'Below the threshold'}
                      onClick={() => void run(`tag-queue/${r.id}/confirm`)}
                    >
                      Confirm
                    </button>{' '}
                    <button
                      className="gk-cp-btn is-small"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run('tag-queue/publish', {
                          gameSlug: r.game.slug,
                          tagSlug: r.tag.slug,
                        })
                      }
                    >
                      Publish as editors
                    </button>{' '}
                    <button
                      className="gk-cp-btn is-small"
                      type="button"
                      disabled={busy}
                      onClick={() => void run(`tag-queue/${r.id}/reject`)}
                    >
                      Reject
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="gk-cp-card">
        <h2 className="gk-cp-card-title">Public issue tags ({q.published.length})</h2>
        {q.published.length === 0 ? (
          <p className="gk-cp-dim">None.</p>
        ) : (
          <table className="gk-cp-table">
            <tbody>
              {q.published.map((r) => (
                <tr key={r.id}>
                  <td>
                    <b>{r.tag.name}</b> on{' '}
                    <a className="gk-cp-link" href={`/games/${r.game.slug}`}>
                      {r.game.name}
                    </a>{' '}
                    <span className="gk-cp-dim">
                      · {r.issueStatus}
                      {r.patchRef ? ` (${r.patchRef})` : ''} · {r.source} · first seen{' '}
                      {day(r.firstSeenAt)} · last confirmed {day(r.lastConfirmedAt)}
                    </span>
                    <Flag row={r} />
                  </td>
                  <td>
                    {r.resolvedAt ? (
                      <button
                        className="gk-cp-btn is-small"
                        type="button"
                        disabled={busy}
                        onClick={() => void run(`tag-queue/${r.id}/reopen`)}
                      >
                        Un-resolve
                      </button>
                    ) : (
                      <>
                        <button
                          className="gk-cp-btn is-small"
                          type="button"
                          disabled={busy}
                          onClick={() => void run(`tag-queue/${r.id}/reconfirm`)}
                        >
                          Re-confirm
                        </button>{' '}
                        <input
                          aria-label="Patch reference"
                          placeholder="patch / version"
                          maxLength={120}
                          value={patch[r.id] ?? ''}
                          onChange={(e) => setPatch({ ...patch, [r.id]: e.target.value })}
                        />{' '}
                        <button
                          className="gk-cp-btn is-small"
                          type="button"
                          disabled={busy || !(patch[r.id] ?? '').trim()}
                          onClick={() =>
                            void run(`tag-queue/${r.id}/resolve`, { patchRef: patch[r.id]!.trim() })
                          }
                        >
                          Resolve
                        </button>
                      </>
                    )}{' '}
                    <button
                      className="gk-cp-btn is-small"
                      type="button"
                      disabled={busy}
                      onClick={() => void run(`tag-queue/${r.id}/reject`)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="gk-cp-card" data-tag-pushback>
        <h2 className="gk-cp-card-title">
          Removed by editors — still being voted for ({q.pushback?.length ?? 0})
        </h2>
        <p className="gk-cp-dim">
          Readers kept voting for these after an editor removed them. They stay removed; re-open one
          to put it back in review.
        </p>
        {!q.pushback?.length ? (
          <p className="gk-cp-dim">None.</p>
        ) : (
          <table className="gk-cp-table">
            <tbody>
              {q.pushback.map((r) => (
                <tr key={r.id}>
                  <td>
                    <b>{r.tag.name}</b> on{' '}
                    <a className="gk-cp-link" href={`/games/${r.game.slug}`}>
                      {r.game.name}
                    </a>{' '}
                    <span className="gk-cp-dim">
                      · removed {day(r.removedAt)} · <b>{r.votesSinceRemoval}</b>{' '}
                      {r.votesSinceRemoval === 1 ? 'vote' : 'votes'} since · weighted{' '}
                      {r.weightedScore.toFixed(1)}
                    </span>
                    <Flag row={r} />
                  </td>
                  <td>
                    <button
                      className="gk-cp-btn is-small"
                      type="button"
                      disabled={busy}
                      onClick={() => void run(`tag-queue/${r.id}/reopen`)}
                    >
                      Re-open for review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="gk-cp-card">
        <h2 className="gk-cp-card-title">Add a tag to a game</h2>
        <div className="gk-nl-form">
          <label className="gk-nl-field">
            <span>Game slug</span>
            <input
              value={direct.gameSlug}
              onChange={(e) => setDirect({ ...direct, gameSlug: e.target.value })}
            />
          </label>
          <label className="gk-nl-field">
            <span>Tag slug</span>
            <input
              value={direct.tagSlug}
              onChange={(e) => setDirect({ ...direct, tagSlug: e.target.value })}
            />
          </label>
          <div className="gk-nl-actions">
            <button
              className="gk-cp-btn is-primary"
              type="button"
              disabled={busy || !direct.gameSlug.trim() || !direct.tagSlug.trim()}
              onClick={() =>
                void run('tag-queue/publish', {
                  gameSlug: direct.gameSlug.trim(),
                  tagSlug: direct.tagSlug.trim(),
                })
              }
            >
              Publish as editors
            </button>{' '}
            <button
              className="gk-cp-btn"
              type="button"
              disabled={busy}
              onClick={() => void runSync()}
            >
              Re-run import mapping
            </button>
          </div>
        </div>
      </section>

      <section className="gk-cp-card">
        <h2 className="gk-cp-card-title">Suggested names ({q.suggestions.length})</h2>
        {q.suggestions.length === 0 ? (
          <p className="gk-cp-dim">None.</p>
        ) : (
          <table className="gk-cp-table">
            <tbody>
              {q.suggestions.map((g) => (
                <tr key={g.id}>
                  <td>
                    <b>{g.rawName}</b>{' '}
                    <span className="gk-cp-dim">
                      · {g.source === 'import' ? 'imported' : 'reader'}
                      {g.game ? ` · ${g.game.name}` : ''} · ×{g.attempts}
                    </span>
                  </td>
                  <td>
                    <select
                      aria-label="Family"
                      value={familyOf[g.id] ?? 'content'}
                      onChange={(e) =>
                        setFamilyOf({ ...familyOf, [g.id]: e.target.value as 'content' | 'issue' })
                      }
                    >
                      <option value="content">content</option>
                      <option value="issue">issue</option>
                    </select>{' '}
                    <button
                      className="gk-cp-btn is-small"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(`tag-queue/suggestions/${g.id}`, {
                          action: 'accept',
                          family: familyOf[g.id] ?? 'content',
                        })
                      }
                    >
                      Accept as new tag
                    </button>{' '}
                    <input
                      aria-label="Merge into tag slug"
                      placeholder="merge into tag slug"
                      value={mergeInto[g.id] ?? ''}
                      onChange={(e) => setMergeInto({ ...mergeInto, [g.id]: e.target.value })}
                    />{' '}
                    <button
                      className="gk-cp-btn is-small"
                      type="button"
                      disabled={busy || !(mergeInto[g.id] ?? '').trim()}
                      onClick={() =>
                        void run(`tag-queue/suggestions/${g.id}`, {
                          action: 'merge',
                          tagSlug: mergeInto[g.id]!.trim(),
                        })
                      }
                    >
                      Merge
                    </button>{' '}
                    <button
                      className="gk-cp-btn is-small"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(`tag-queue/suggestions/${g.id}`, { action: 'reject' })
                      }
                    >
                      Reject
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {s ? (
        <section className="gk-cp-card">
          <h2 className="gk-cp-card-title">Tag settings</h2>
          <div className="gk-nl-form">
            {num('publishThreshold', 'Publish threshold (weighted score)', 0.5)}
            {num('minCredibility', 'Minimum voter credibility (0–1)', 0.05)}
            {num('issueExpiryDays', 'Vote-driven issue → “Past issue” after (days)')}
            {num('indexMinGames', 'Tag page indexable from (published games)')}
            {num('catalogCardCount', 'Tags on a catalog card')}
            {num('burstWindowHours', 'Spike window (hours)')}
            {num('burstMinVotes', 'Spike: minimum votes in window')}
            {num('burstMultiplier', 'Spike: × the usual rate', 0.5)}
            {num('lowCredibilityShare', 'Spike: low-credibility share to flag (0–1)', 0.05)}
            {num('quickViewCacheSeconds', 'Quick view cache (seconds, 0 = off)')}
            <label className="gk-nl-check">
              <input
                type="checkbox"
                checked={s.showAnomalyLabel}
                onChange={(e) => setS({ ...s, showAnomalyLabel: e.target.checked })}
              />
              <span>
                Show “Unusual voting activity” publicly on flagged tags (editors always see it here)
              </span>
            </label>
            <div className="gk-nl-actions">
              <button
                className="gk-cp-btn is-primary"
                type="button"
                disabled={busy}
                onClick={() => void saveSettings()}
              >
                Save settings
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
