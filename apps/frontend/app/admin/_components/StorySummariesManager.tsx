'use client';

import { useState } from 'react';
import { adminFetch } from '../_lib/adminFetch';
import type { StorySummaryRow } from '../lib';

/**
 * Story AI text (Phase P S5, moderator+). The automatic TL;DR and summary show
 * with the locked "AI summary" label (EU AI Act transparency). Approving makes
 * the current text editorial — the label goes, who + when are recorded — and a
 * later automatic regeneration brings it back. Editing the TL;DR / summary on
 * the story's edit page approves that field too.
 */
type Filter = 'ai' | 'editorial' | 'all';

export function StorySummariesManager({
  initial,
}: {
  initial: StorySummaryRow[];
}): React.JSX.Element {
  const [rows, setRows] = useState(initial);
  const [filter, setFilter] = useState<Filter>('ai');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(f: Filter): Promise<void> {
    setFilter(f);
    const res = await adminFetch(`/admin/api/story-summaries?filter=${f}`);
    const json = (await res.json().catch(() => ({}))) as { data?: StorySummaryRow[] };
    if (res.ok && json.data) setRows(json.data);
  }
  async function post(id: string, action: 'approve' | 'withdraw'): Promise<void> {
    setBusy(true);
    const res = await adminFetch(`/admin/api/story-summaries/${id}/${action}`, { method: 'POST' });
    const json = (await res.json().catch(() => ({}))) as { message?: string };
    setBusy(false);
    setMsg(
      res.ok
        ? action === 'approve'
          ? 'Approved — now editorial (no AI label).'
          : 'Approval withdrawn — the AI label is back.'
        : `Failed: ${json.message ?? `HTTP ${res.status}`}`,
    );
    if (res.ok) await load(filter);
  }

  return (
    <div className="gk-cp-page">
      <header className="gk-cp-page-head">
        <h1 className="gk-cp-page-title">Story AI text</h1>
        <p className="gk-cp-page-sub">
          Automatic TL;DRs and summaries carry a visible “AI summary” label (locked). Approve the
          text you have reviewed and it becomes editorial — your name and the time are recorded.
        </p>
      </header>
      {msg && <div className="gk-cp-note gk-cp-flash">{msg}</div>}
      <section className="gk-cp-card">
        <div className="gk-nl-actions">
          {(['ai', 'editorial', 'all'] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`gk-cp-btn is-small${filter === f ? ' is-primary' : ''}`}
              onClick={() => void load(f)}
            >
              {f === 'ai' ? 'Labelled AI' : f === 'editorial' ? 'Editorial' : 'All'}
            </button>
          ))}
        </div>
        {rows.length === 0 ? (
          <p className="gk-cp-dim">Nothing here.</p>
        ) : (
          <table className="gk-cp-table" data-story-summaries>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <b>
                      <a
                        className="gk-cp-link"
                        href={`/topics/${r.slug}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {r.title}
                      </a>
                    </b>
                    {r.tldr ? (
                      <div>
                        <span className="gk-cp-dim">
                          TL;DR {r.tldrIsAi ? '(AI)' : '(editorial)'}:
                        </span>{' '}
                        {r.tldr}
                      </div>
                    ) : null}
                    {r.aiSummary ? (
                      <div>
                        <span className="gk-cp-dim">
                          Summary {r.summaryIsAi ? '(AI)' : '(editorial)'}:
                        </span>{' '}
                        {r.aiSummary}
                      </div>
                    ) : null}
                    {r.summaryApprovedBy || r.tldrApprovedBy ? (
                      <div className="gk-cp-dim">
                        Approved by {r.summaryApprovedBy ?? r.tldrApprovedBy}
                        {r.approvedAt
                          ? ` · ${r.approvedAt.slice(0, 16).replace('T', ' ')} UTC`
                          : ''}
                        {r.locked.some((f) => f === 'tldr' || f === 'aiSummary')
                          ? ' · locked (edited)'
                          : ''}
                      </div>
                    ) : null}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {r.tldrIsAi || r.summaryIsAi ? (
                      <button
                        className="gk-cp-btn is-small is-primary"
                        type="button"
                        disabled={busy}
                        onClick={() => void post(r.id, 'approve')}
                      >
                        Approve
                      </button>
                    ) : (
                      <button
                        className="gk-cp-btn is-small"
                        type="button"
                        disabled={busy}
                        onClick={() => void post(r.id, 'withdraw')}
                      >
                        Withdraw approval
                      </button>
                    )}{' '}
                    <a className="gk-cp-btn is-small" href={`/admin/topics/${r.id}`}>
                      Edit
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
