'use client';

import { useState } from 'react';
import { adminFetch } from '../_lib/adminFetch';
import type { IntegrityReviewRow, IntegritySignalRow } from '../lib';

/**
 * Review-integrity moderation (Phase P S1; moderator+). Auto-detected signals
 * wait here as "detected" — with auto-publish off they are NOT public until a
 * moderator confirms them. Moderators can also dismiss a false hit or add a
 * signal the scan missed (note + date are the public evidence). Every decision
 * is audited. All text is rendered escaped (React children).
 */
const KIND_LABEL: Record<IntegritySignalRow['kind'], string> = {
  review_copy: 'Review copy from publisher',
  embargo: 'Embargo',
  sponsored_event: 'Sponsored event / press trip',
};

const day = (v: string | null): string =>
  v
    ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(v))
    : '—';

async function errorText(res: Response): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
  return j.message ?? j.error ?? String(res.status);
}

function AddSignalForm({
  articleId,
  onDone,
}: {
  articleId: string;
  onDone: (msg: string) => void;
}): React.JSX.Element {
  const [kind, setKind] = useState<IntegritySignalRow['kind']>('review_copy');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    setBusy(true);
    try {
      const res = await adminFetch(`/admin/api/integrity/articles/${articleId}/signals`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, note, evidenceDate: date }),
      });
      onDone(res.ok ? 'Signal saved (confirmed).' : `Save failed: ${await errorText(res)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gk-nl-form">
      <label className="gk-nl-field">
        <span>Signal</span>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as IntegritySignalRow['kind'])}
        >
          {Object.entries(KIND_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="gk-nl-field">
        <span>Evidence date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="gk-nl-field gk-nl-field-wide">
        <span>
          Editor note <span className="gk-cp-dim">· public evidence, 3–500 characters</span>
        </span>
        <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="gk-nl-actions">
        <button className="gk-cp-btn" type="button" disabled={busy} onClick={submit}>
          Add / confirm signal
        </button>
      </div>
    </div>
  );
}

export function IntegrityManager({
  initial,
  autoPublish,
}: {
  initial: IntegrityReviewRow[];
  autoPublish: boolean;
}): React.JSX.Element {
  const [reviews, setReviews] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');

  async function reload(message: string): Promise<void> {
    setMsg(message);
    const res = await adminFetch('/admin/api/integrity/reviews');
    if (res.ok)
      setReviews(((await res.json()) as { data: { reviews: IntegrityReviewRow[] } }).data.reviews);
  }

  async function decide(id: string, action: 'confirm' | 'dismiss'): Promise<void> {
    const res = await adminFetch(`/admin/api/integrity/signals/${id}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    await reload(res.ok ? `Signal ${action}ed.` : `Failed: ${await errorText(res)}`);
  }

  async function rescan(): Promise<void> {
    const res = await adminFetch('/admin/api/integrity/rescan', { method: 'POST' });
    setMsg(res.ok ? 'Re-scan queued — refresh in a moment.' : `Failed: ${await errorText(res)}`);
  }

  const shown =
    filter === 'pending'
      ? reviews.filter((r) => r.signals.some((s) => s.status === 'detected'))
      : reviews;

  return (
    <div className="gk-cp-page">
      <header className="gk-cp-page-head">
        <h1 className="gk-cp-page-title">Review integrity</h1>
        <p className="gk-cp-page-sub">
          Evidence of how each review was produced — publisher review copy, embargo, sponsored event
          or press trip. Auto-publish is <b>{autoPublish ? 'on' : 'off'}</b>
          {autoPublish
            ? ': detected signals show publicly until dismissed.'
            : ': detected signals stay here until you confirm them.'}
        </p>
      </header>

      {msg && <div className="gk-cp-note gk-cp-flash">{msg}</div>}

      <section className="gk-cp-card">
        <div className="gk-cp-card-head">
          <h2 className="gk-cp-card-title">
            Reviews ({shown.length}
            {filter === 'pending' ? ' with signals awaiting a decision' : ''})
          </h2>
          <div className="gk-nl-actions">
            <button
              className="gk-cp-btn"
              type="button"
              onClick={() => setFilter(filter === 'pending' ? 'all' : 'pending')}
            >
              {filter === 'pending' ? 'Show all reviews' : 'Show pending only'}
            </button>
            <button className="gk-cp-btn" type="button" onClick={rescan}>
              Re-scan feed
            </button>
          </div>
        </div>
        <div className="gk-cp-tablewrap">
          <table className="gk-cp-table">
            <thead>
              <tr>
                <th>Review</th>
                <th>Signals</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.articleId}>
                  <td>
                    <b>{r.title}</b>
                    <div className="gk-cp-dim">
                      {r.sourceName ?? '—'} · {day(r.publishDate)}
                      {r.url ? (
                        <>
                          {' · '}
                          <a
                            className="gk-cp-link"
                            href={r.url}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                          >
                            source ↗
                          </a>
                        </>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    {r.signals.length === 0 ? (
                      <span className="gk-cp-dim">None found</span>
                    ) : (
                      r.signals.map((s) => (
                        <div key={s.id} className="gk-integrity-admin-row">
                          <b>{KIND_LABEL[s.kind]}</b>{' '}
                          <span
                            className={`gk-adstate is-${s.status === 'confirmed' ? 'active' : s.status === 'dismissed' ? 'ended' : 'scheduled'}`}
                          >
                            {s.status}
                          </span>{' '}
                          <span className="gk-cp-dim">({s.origin})</span>
                          {s.evidenceSnippet ? <div>“{s.evidenceSnippet}”</div> : null}
                          {s.editorNote ? <div>Note: {s.editorNote}</div> : null}
                          <div className="gk-cp-dim">
                            {day(s.evidenceDate)}
                            {s.decidedByLabel ? ` · ${s.decidedByLabel}, ${day(s.decidedAt)}` : ''}
                          </div>
                          <div className="gk-nl-actions">
                            {s.status !== 'confirmed' ? (
                              <button
                                className="gk-cp-btn"
                                type="button"
                                onClick={() => decide(s.id, 'confirm')}
                              >
                                Confirm
                              </button>
                            ) : null}
                            {s.status !== 'dismissed' ? (
                              <button
                                className="gk-cp-btn"
                                type="button"
                                onClick={() => decide(s.id, 'dismiss')}
                              >
                                Dismiss
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ))
                    )}
                  </td>
                  <td>
                    {openId === r.articleId ? (
                      <AddSignalForm
                        articleId={r.articleId}
                        onDone={(m) => {
                          setOpenId(null);
                          void reload(m);
                        }}
                      />
                    ) : (
                      <button
                        className="gk-cp-btn"
                        type="button"
                        onClick={() => setOpenId(r.articleId)}
                      >
                        Add signal
                      </button>
                    )}
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
