'use client';

import { useState } from 'react';
import { adminFetch } from '../_lib/adminFetch';
import type { NewsletterOverview, SubscriberRow } from '../lib';

/**
 * Newsletter Control Panel (SPEC I8, Slice 3). Compose/segment/send campaigns
 * over the Mock send seam (→ email_outbox, zero network), generate a digest from
 * the EXISTING summaries (no new AI), and manage subscribers. Segmentation is
 * GDPR-gated server-side (active + consented only). Every mutation is audited.
 */

const day = (v: string | null): string =>
  v
    ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(v))
    : '—';

function Stat({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <div className="gk-cp-stat">
      <span className="gk-cp-stat-value">{value.toLocaleString('en-US')}</span>
      <span className="gk-cp-stat-label">{label}</span>
    </div>
  );
}

export function NewsletterManager({
  initialOverview,
  initialSubscribers,
}: {
  initialOverview: NewsletterOverview;
  initialSubscribers: SubscriberRow[];
}): React.JSX.Element {
  const [overview, setOverview] = useState(initialOverview);
  const [subscribers, setSubscribers] = useState(initialSubscribers);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [subject, setSubject] = useState('');
  const [preheader, setPreheader] = useState('');
  const [segment, setSegment] = useState('all');
  const [body, setBody] = useState('');
  const [search, setSearch] = useState('');

  const segments = ['all', ...overview.segments.map((s) => s.segment).filter((s) => s !== 'all')];
  const maxGrowth = Math.max(1, ...overview.growth.map((g) => g.activeSubscribers));

  async function refresh(): Promise<void> {
    const [ov, subs] = await Promise.all([
      adminFetch('/admin/api/newsletter/overview'),
      adminFetch(
        `/admin/api/newsletter/subscribers${search ? `?q=${encodeURIComponent(search)}` : ''}`,
      ),
    ]);
    if (ov.ok) setOverview((await ov.json()).data);
    if (subs.ok) setSubscribers((await subs.json()).data);
  }

  async function act(label: string, run: () => Promise<Response>, okMsg: string): Promise<void> {
    setBusy(true);
    setMsg(null);
    try {
      const res = await run();
      if (res.ok) {
        setMsg(okMsg);
        await refresh();
      } else {
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        setMsg(`${label} failed: ${j.message ?? res.status}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(): Promise<void> {
    if (!subject.trim() || !body.trim()) {
      setMsg('A subject and body are required.');
      return;
    }
    await act(
      'Save',
      () =>
        adminFetch('/admin/api/newsletter/campaigns', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            subject,
            preheader: preheader || undefined,
            segment,
            body,
          }),
        }),
      'Draft saved.',
    );
    setSubject('');
    setPreheader('');
    setBody('');
  }

  const generateDigest = (): Promise<void> =>
    act(
      'Digest',
      () => adminFetch('/admin/api/newsletter/digest', { method: 'POST' }),
      'Digest draft generated from existing summaries.',
    );

  const send = (id: string): Promise<void> =>
    act(
      'Send',
      () => adminFetch(`/admin/api/newsletter/campaigns/${id}/send`, { method: 'POST' }),
      'Campaign sent to its consented audience (demo: written to the outbox).',
    );

  const unsub = (id: string): Promise<void> =>
    act(
      'Unsubscribe',
      () => adminFetch(`/admin/api/newsletter/subscribers/${id}/unsubscribe`, { method: 'POST' }),
      'Subscriber unsubscribed.',
    );

  async function runSearch(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const res = await adminFetch(
      `/admin/api/newsletter/subscribers${search ? `?q=${encodeURIComponent(search)}` : ''}`,
    );
    if (res.ok) setSubscribers((await res.json()).data);
  }

  return (
    <div className="gk-cp-page">
      <header className="gk-cp-page-head">
        <h1 className="gk-cp-page-title">Newsletter</h1>
        <p className="gk-cp-page-sub">
          Compose, segment and send. Segmentation targets only <b>consented, active</b> subscribers;
          the demo send writes to the outbox (no real email). Digest reuses existing story
          summaries.
        </p>
      </header>

      {msg && <div className="gk-cp-note gk-cp-flash">{msg}</div>}

      <section className="gk-cp-stats">
        <Stat label="Total subscribers" value={overview.subscribers.total} />
        <Stat label="Active" value={overview.subscribers.active} />
        <Stat label="Unsubscribed" value={overview.subscribers.unsubscribed} />
      </section>

      <section className="gk-cp-card">
        <h2 className="gk-cp-card-title">Growth · active subscribers (last 8 weeks)</h2>
        <div className="gk-nl-spark">
          {overview.growth.map((g) => (
            <div
              key={g.weekEnding}
              className="gk-nl-spark-col"
              title={`${g.weekEnding}: ${g.activeSubscribers}`}
            >
              <span
                className="gk-nl-spark-bar"
                style={{ height: `${Math.round((g.activeSubscribers / maxGrowth) * 100)}%` }}
              />
              <span className="gk-nl-spark-label">{g.weekEnding.slice(5)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="gk-cp-card">
        <div className="gk-cp-card-head">
          <h2 className="gk-cp-card-title">Compose a campaign</h2>
          <button className="gk-cp-btn" type="button" disabled={busy} onClick={generateDigest}>
            Generate digest draft
          </button>
        </div>
        <div className="gk-nl-form">
          <label className="gk-nl-field">
            <span>Subject</span>
            <input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
          </label>
          <label className="gk-nl-field">
            <span>Preheader (optional)</span>
            <input
              value={preheader}
              maxLength={200}
              onChange={(e) => setPreheader(e.target.value)}
            />
          </label>
          <label className="gk-nl-field">
            <span>Segment</span>
            <select value={segment} onChange={(e) => setSegment(e.target.value)}>
              {segments.map((s) => (
                <option key={s} value={s}>
                  {s}
                  {s !== 'all'
                    ? ` (${overview.segments.find((x) => x.segment === s)?.active ?? 0})`
                    : ` (${overview.subscribers.active})`}
                </option>
              ))}
            </select>
          </label>
          <label className="gk-nl-field gk-nl-field-wide">
            <span>Body (plain text)</span>
            <textarea
              rows={6}
              value={body}
              maxLength={20000}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <div className="gk-nl-actions">
            <button
              className="gk-cp-btn is-primary"
              type="button"
              disabled={busy}
              onClick={saveDraft}
            >
              Save draft
            </button>
          </div>
        </div>
      </section>

      <section className="gk-cp-card">
        <h2 className="gk-cp-card-title">Campaigns</h2>
        <div className="gk-cp-tablewrap">
          <table className="gk-cp-table">
            <thead>
              <tr>
                <th>Subject</th>
                <th>Segment</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Recipients</th>
                <th>Sent / scheduled</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {overview.campaigns.length === 0 ? (
                <tr>
                  <td colSpan={7} className="gk-cp-dim">
                    No campaigns yet. Compose one above or generate a digest draft.
                  </td>
                </tr>
              ) : (
                overview.campaigns.map((c) => (
                  <tr key={c.id}>
                    <td>{c.subject}</td>
                    <td className="gk-cp-dim">{c.segment}</td>
                    <td className="gk-cp-dim">{c.kind}</td>
                    <td>
                      <span className={`gk-adstate is-${c.status}`}>{c.status}</span>
                    </td>
                    <td>{c.recipientCount.toLocaleString('en-US')}</td>
                    <td className="gk-cp-dim">{day(c.sentAt ?? c.scheduledAt)}</td>
                    <td>
                      {c.status === 'draft' || c.status === 'scheduled' ? (
                        <button
                          className="gk-cp-btn is-small"
                          type="button"
                          disabled={busy}
                          onClick={() => send(c.id)}
                        >
                          Send
                        </button>
                      ) : (
                        <span className="gk-cp-dim">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="gk-cp-card">
        <div className="gk-cp-card-head">
          <h2 className="gk-cp-card-title">Subscribers</h2>
          <a className="gk-cp-link" href="/admin/api/newsletter/subscribers/export">
            Export CSV ↓
          </a>
        </div>
        <form className="gk-nl-search" onSubmit={runSearch}>
          <input
            placeholder="Search by email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="gk-cp-btn is-small" type="submit">
            Search
          </button>
        </form>
        <div className="gk-cp-tablewrap">
          <table className="gk-cp-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Source</th>
                <th>State</th>
                <th>Type</th>
                <th>Joined</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {subscribers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="gk-cp-dim">
                    No subscribers match.
                  </td>
                </tr>
              ) : (
                subscribers.map((s) => (
                  <tr key={s.id}>
                    <td>{s.email}</td>
                    <td className="gk-cp-dim">{s.source}</td>
                    <td>
                      <span className={`gk-adstate is-${s.active ? 'active' : 'ended'}`}>
                        {s.active ? 'active' : 'unsubscribed'}
                      </span>
                    </td>
                    <td className="gk-cp-dim">{s.registered ? 'registered' : 'anonymous'}</td>
                    <td className="gk-cp-dim">{day(s.createdAt)}</td>
                    <td>
                      {s.active ? (
                        <button
                          className="gk-cp-btn is-small"
                          type="button"
                          disabled={busy}
                          onClick={() => unsub(s.id)}
                        >
                          Unsubscribe
                        </button>
                      ) : (
                        <span className="gk-cp-dim">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
