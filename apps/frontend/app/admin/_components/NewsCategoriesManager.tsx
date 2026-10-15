'use client';

import { useState } from 'react';
import { adminFetch } from '../_lib/adminFetch';
import type { NewsCategoryOverview } from '../lib';

/**
 * News categories (Phase P S4) — how much of the feed falls in each category and
 * what each mode does. The categories themselves (label, mode, keywords,
 * priority) are edited in the generic resource editor; an article or story can
 * be overridden from its own edit page. Reclassifying runs as a background job.
 */
const MODE_TEXT: Record<NewsCategoryOverview['mode'], string> = {
  show: 'Shown everywhere',
  low: 'Low: kept off the top surfaces (Trending, Latest, briefing counts, newsletter) — in “More from the feed”, on game and source pages with a chip, and searchable',
  hide: 'Hidden: dropped from every public feed and count; not searchable by default',
};

export function NewsCategoriesManager({
  initial,
}: {
  initial: NewsCategoryOverview[];
}): React.JSX.Element {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reclassify(): Promise<void> {
    setBusy(true);
    const res = await adminFetch('/admin/api/news/reclassify', { method: 'POST' });
    const json = (await res.json().catch(() => ({}))) as {
      jobId?: string | null;
      message?: string;
    };
    setBusy(false);
    setMsg(
      res.ok
        ? `Reclassify queued (job ${json.jobId ?? 'already queued'}). Counts update when it finishes — reload the page.`
        : `Failed: ${json.message ?? `HTTP ${res.status}`}`,
    );
  }

  return (
    <div className="gk-cp-page">
      <header className="gk-cp-page-head">
        <h1 className="gk-cp-page-title">News categories</h1>
        <p className="gk-cp-page-sub">
          Every article gets a category: the feed’s own type wins, then the first keyword match by
          priority (title only unless “classify excerpt” is on in Rules &amp; limits → News), else
          News. A story takes the category of most of its articles (share set in Rules &amp;
          limits).
        </p>
      </header>
      {msg && <div className="gk-cp-note gk-cp-flash">{msg}</div>}

      <section className="gk-cp-card">
        <table className="gk-cp-table" data-news-categories>
          <thead>
            <tr>
              <th>Category</th>
              <th>Mode</th>
              <th>Articles</th>
              <th>Stories</th>
              <th>Keywords</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {initial.map((c) => (
              <tr key={c.key} data-category={c.key} data-mode={c.mode}>
                <td>
                  <b>{c.label}</b> <span className="gk-cp-dim">{c.key}</span>
                  {c.active ? null : <span className="gk-cp-dim"> · inactive</span>}
                </td>
                <td title={MODE_TEXT[c.mode]}>{c.mode}</td>
                <td>{c.articles}</td>
                <td>{c.stories}</td>
                <td className="gk-cp-dim">
                  {c.keywords.length ? c.keywords.map((k) => `“${k}”`).join(' ') : '—'}
                </td>
                <td>
                  <a className="gk-cp-link" href={`/admin/news-categories/${c.id}`}>
                    Edit
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="gk-cp-dim">
          {(Object.keys(MODE_TEXT) as NewsCategoryOverview['mode'][]).map((m) => (
            <li key={m}>
              <b>{m}</b> — {MODE_TEXT[m]}
            </li>
          ))}
        </ul>
        <div className="gk-nl-actions">
          <a className="gk-cp-btn" href="/admin/news-categories/new">
            Add a category
          </a>{' '}
          <button
            className="gk-cp-btn is-primary"
            type="button"
            disabled={busy}
            onClick={() => void reclassify()}
          >
            Reclassify all articles
          </button>
        </div>
      </section>
    </div>
  );
}
