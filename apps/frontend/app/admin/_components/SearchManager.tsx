'use client';

import { useState } from 'react';
import { adminFetch } from '../_lib/adminFetch';

/**
 * Search (Phase P S4) — try a query and see the raw ranking with scores (no
 * cache, no editor pins), and rebuild the index as a background job. Weights,
 * fuzzy matching, limits and the typeahead rate limit are in Rules & limits →
 * Search; per-query pins / excludes are List curation (page kind “search”, page
 * key = the normalised query, item keys “game:slug”, “topic:slug”, “source:slug”).
 * A game, story or source can be kept out of search from its own edit page.
 */
type Group = 'games' | 'stories' | 'sources';
interface Hit {
  slug: string;
  title: string;
  subtitle: string | null;
  category: string | null;
  score: number;
}
const GROUPS: Group[] = ['games', 'stories', 'sources'];

export function SearchManager(): React.JSX.Element {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<{ q: string; hits: Record<Group, Hit[]> } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function test(): Promise<void> {
    setBusy(true);
    const r = await adminFetch(`/admin/api/search/test?q=${encodeURIComponent(q)}`);
    const json = (await r.json().catch(() => ({}))) as {
      data?: { q: string; hits: Record<Group, Hit[]> };
      message?: string;
    };
    setBusy(false);
    if (r.ok && json.data) {
      setRes(json.data);
      setMsg(null);
    } else setMsg(`Failed: ${json.message ?? `HTTP ${r.status}`}`);
  }
  async function reindex(): Promise<void> {
    setBusy(true);
    const r = await adminFetch('/admin/api/search/reindex', { method: 'POST' });
    const json = (await r.json().catch(() => ({}))) as { jobId?: string | null; message?: string };
    setBusy(false);
    setMsg(
      r.ok
        ? `Reindex queued (job ${json.jobId ?? 'already queued'}).`
        : `Failed: ${json.message ?? `HTTP ${r.status}`}`,
    );
  }

  return (
    <div className="gk-cp-page">
      <header className="gk-cp-page-head">
        <h1 className="gk-cp-page-title">Search</h1>
        <p className="gk-cp-page-sub">
          Games (title, alternate names, developer, publisher), public stories and sources. The
          index rebuilds after every ingest and edit; rebuild it by hand here. Settings: Rules &amp;
          limits → Search. Per-query pins and excludes: List curation, page kind “search”, page key
          = the query in lowercase, item keys like “game:baldurs-gate-3”.
        </p>
      </header>
      {msg && <div className="gk-cp-note gk-cp-flash">{msg}</div>}

      <section className="gk-cp-card">
        <form
          className="gk-nl-form"
          onSubmit={(e) => {
            e.preventDefault();
            void test();
          }}
        >
          <label className="gk-nl-field">
            <span>Test query</span>
            <input value={q} maxLength={200} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="gk-nl-actions">
            <button className="gk-cp-btn is-primary" type="submit" disabled={busy || !q.trim()}>
              Test
            </button>{' '}
            <button
              className="gk-cp-btn"
              type="button"
              disabled={busy}
              onClick={() => void reindex()}
            >
              Rebuild index
            </button>
          </div>
        </form>
        {res ? (
          <div data-search-test>
            <p className="gk-cp-dim">Normalised: “{res.q}” (raw ranking — no cache, no pins)</p>
            {GROUPS.map((g) => (
              <div key={g}>
                <h3 className="gk-cp-card-title">
                  {g} ({res.hits[g].length})
                </h3>
                {res.hits[g].length === 0 ? (
                  <p className="gk-cp-dim">No hits.</p>
                ) : (
                  <table className="gk-cp-table">
                    <tbody>
                      {res.hits[g].map((h) => (
                        <tr key={h.slug}>
                          <td>
                            <b>{h.title}</b> <span className="gk-cp-dim">{h.slug}</span>
                            {h.category ? <span className="gk-cp-dim"> · {h.category}</span> : null}
                          </td>
                          <td className="gk-mono">{h.score.toFixed(3)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
