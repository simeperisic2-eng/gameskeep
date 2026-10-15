'use client';

import { useState } from 'react';
import { adminFetch } from '../_lib/adminFetch';
import type { AdminListRow, ListsQueueData } from '../lib';

/**
 * Editorial lists (Phase P S4) — editors confirm or reject list CANDIDATES that
 * ingest found, add lists by hand (outlet + link), paste ranked entries (each
 * auto-matched to a game; re-match, clear or send a name to the unmatched-games
 * queue), and preview the consensus. Only confirmed lists are ever public, and
 * only as consensus / per-game positions / links out — never the full list.
 */
interface Entry {
  id: string;
  rank: number;
  rawName: string;
  match: string;
  gameSlug: string | null;
  gameName: string | null;
}
interface ListDetail {
  list: AdminListRow & { notes: string | null };
  entries: Entry[];
}
interface ConsensusRow {
  slug: string;
  name: string;
  appearances: number;
  avgRank: number;
  position: number | null;
  inConsensus: boolean;
  positions: { outlet: string; rank: number }[];
  lines: { key: string; text: string }[];
}

async function call(
  path: string,
  method: string,
  body?: unknown,
): Promise<{ ok: boolean; json: Record<string, unknown> }> {
  const res = await adminFetch(`/admin/api/${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok && !json.message) {
    const issues = json.issues as { message?: string }[] | undefined;
    json.message = issues?.map((i) => i.message).join('; ') || `HTTP ${res.status}`;
  }
  return { ok: res.ok, json };
}

function ListTable({
  rows,
  onOpen,
}: {
  rows: AdminListRow[];
  onOpen: (id: string) => void;
}): React.JSX.Element {
  if (rows.length === 0) return <p className="gk-cp-dim">None.</p>;
  return (
    <table className="gk-cp-table">
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>
              <b>{r.outletName}</b> — {r.title}{' '}
              <span className="gk-cp-dim">
                · {r.year ?? 'no year'} · {r.categoryKey ?? 'no category'} · {r.entries} entries (
                {r.matched} matched) · {r.detectedBy}
              </span>
            </td>
            <td>
              <button className="gk-cp-btn is-small" type="button" onClick={() => onOpen(r.id)}>
                Open
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function EditorialListsManager({
  initial,
  lexicon,
}: {
  initial: ListsQueueData;
  lexicon: { patterns: string[]; gotyPatterns: string[] };
}): React.JSX.Element {
  const [q, setQ] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<ListDetail | null>(null);
  const [meta, setMeta] = useState<Record<string, string>>({});
  const [entriesText, setEntriesText] = useState('');
  const [matchSlug, setMatchSlug] = useState<Record<string, string>>({});
  const [added, setAdded] = useState({
    outletName: '',
    sourceSlug: '',
    title: '',
    url: '',
    year: '',
    categoryKey: '',
  });
  const [lex, setLex] = useState({
    patterns: lexicon.patterns.join('\n'),
    goty: lexicon.gotyPatterns.join('\n'),
  });
  const [pair, setPair] = useState<string>('');
  const [consensus, setConsensus] = useState<ConsensusRow[] | null>(null);

  async function reload(): Promise<void> {
    const r = await call('editorial-lists/queue', 'GET');
    if (r.ok) setQ((r.json as { data: ListsQueueData }).data);
  }
  async function open(id: string): Promise<void> {
    const r = await call(`editorial-lists/${id}`, 'GET');
    if (!r.ok) {
      setMsg(String(r.json.message));
      return;
    }
    const d = (r.json as { data: ListDetail }).data;
    setDetail(d);
    setMeta({
      outletName: d.list.outletName,
      title: d.list.title,
      url: d.list.url ?? '',
      year: d.list.year ? String(d.list.year) : '',
      categoryKey: d.list.categoryKey ?? '',
    });
    setEntriesText(d.entries.map((e) => `${e.rank}. ${e.rawName}`).join('\n'));
  }
  async function act(
    fn: () => Promise<{ ok: boolean; json: Record<string, unknown> }>,
    done: string,
  ): Promise<void> {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    setMsg(
      r.ok
        ? `${done}${r.json.jobId ? ` — consensus recompute queued (job ${String(r.json.jobId)}).` : ''}`
        : `Failed: ${String(r.json.message)}`,
    );
    if (r.ok) {
      await reload();
      if (detail) await open(detail.list.id);
    }
  }

  const id = detail?.list.id ?? '';
  const metaBody = {
    outletName: meta.outletName,
    title: meta.title,
    url: meta.url,
    year: meta.year ? Number(meta.year) : null,
    categoryKey: meta.categoryKey || null,
  };

  return (
    <div className="gk-cp-page">
      <header className="gk-cp-page-head">
        <h1 className="gk-cp-page-title">Editorial lists</h1>
        <p className="gk-cp-page-sub">
          Outlets’ official year-end lists. Ingest only files candidates; only lists you confirm are
          public — as the consensus, each game’s positions and a link to the original. The full
          entries stay here.
        </p>
      </header>
      {msg && <div className="gk-cp-note gk-cp-flash">{msg}</div>}

      <section className="gk-cp-card" data-lists-candidates>
        <h2 className="gk-cp-card-title">Candidates ({q.candidates.length})</h2>
        <ListTable rows={q.candidates} onOpen={(x) => void open(x)} />
      </section>

      {detail ? (
        <section className="gk-cp-card" data-list-editor>
          <h2 className="gk-cp-card-title">
            {detail.list.outletName} — {detail.list.title}{' '}
            <span className="gk-cp-dim">
              · {detail.list.status} · id {detail.list.id}
            </span>
          </h2>
          <div className="gk-nl-form">
            {(['outletName', 'title', 'url', 'year'] as const).map((k) => (
              <label key={k} className="gk-nl-field">
                <span>{k}</span>
                <input
                  value={meta[k] ?? ''}
                  onChange={(e) => setMeta({ ...meta, [k]: e.target.value })}
                />
              </label>
            ))}
            <label className="gk-nl-field">
              <span>category</span>
              <select
                value={meta.categoryKey ?? ''}
                onChange={(e) => setMeta({ ...meta, categoryKey: e.target.value })}
              >
                <option value="">—</option>
                {q.categories.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                    {c.active ? '' : ' (inactive)'}
                  </option>
                ))}
              </select>
            </label>
            <div className="gk-nl-actions">
              <button
                className="gk-cp-btn"
                type="button"
                disabled={busy}
                onClick={() =>
                  void act(() => call(`editorial-lists/${id}`, 'PATCH', metaBody), 'Saved.')
                }
              >
                Save details
              </button>{' '}
              {detail.list.status !== 'confirmed' ? (
                <button
                  className="gk-cp-btn is-primary"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => call(`editorial-lists/${id}/decision`, 'POST', { status: 'confirmed' }),
                      'Confirmed.',
                    )
                  }
                >
                  Confirm (public)
                </button>
              ) : null}{' '}
              {detail.list.status !== 'rejected' ? (
                <button
                  className="gk-cp-btn"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => call(`editorial-lists/${id}/decision`, 'POST', { status: 'rejected' }),
                      'Rejected.',
                    )
                  }
                >
                  Reject
                </button>
              ) : null}{' '}
              {detail.list.status !== 'candidate' ? (
                <button
                  className="gk-cp-btn"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => call(`editorial-lists/${id}/decision`, 'POST', { status: 'candidate' }),
                      'Back in the queue.',
                    )
                  }
                >
                  Back to candidates
                </button>
              ) : null}
            </div>
          </div>

          <h3 className="gk-cp-card-title">Entries (admin only — never published as a list)</h3>
          <label className="gk-nl-field gk-nl-field-wide">
            <span>
              Ranked lines{' '}
              <span className="gk-cp-dim">
                · “1. Name”, “#2 Name”, “3) Name” or one name per line
              </span>
            </span>
            <textarea
              rows={8}
              value={entriesText}
              onChange={(e) => setEntriesText(e.target.value)}
            />
          </label>
          <div className="gk-nl-actions">
            <button
              className="gk-cp-btn is-primary"
              type="button"
              disabled={busy}
              onClick={() =>
                void act(
                  () => call(`editorial-lists/${id}/entries`, 'PUT', { text: entriesText }),
                  'Entries saved and matched.',
                )
              }
            >
              Save entries (auto-match)
            </button>
          </div>
          <table className="gk-cp-table">
            <tbody>
              {detail.entries.map((e) => (
                <tr key={e.id} data-entry={e.match}>
                  <td>
                    #{e.rank} <b>{e.rawName}</b>{' '}
                    <span className="gk-cp-dim">
                      → {e.gameName ? `${e.gameName} (${e.gameSlug})` : 'no game'} · {e.match}
                    </span>
                  </td>
                  <td>
                    <input
                      aria-label="Game slug"
                      placeholder="game slug"
                      value={matchSlug[e.id] ?? ''}
                      onChange={(ev) => setMatchSlug({ ...matchSlug, [e.id]: ev.target.value })}
                    />{' '}
                    <button
                      className="gk-cp-btn is-small"
                      type="button"
                      disabled={busy || !(matchSlug[e.id] ?? '').trim()}
                      onClick={() =>
                        void act(
                          () =>
                            call(`editorial-lists/entries/${e.id}/match`, 'POST', {
                              gameSlug: matchSlug[e.id]!.trim(),
                            }),
                          'Matched.',
                        )
                      }
                    >
                      Match
                    </button>{' '}
                    <button
                      className="gk-cp-btn is-small"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          () =>
                            call(`editorial-lists/entries/${e.id}/match`, 'POST', {
                              gameSlug: null,
                            }),
                          'Cleared.',
                        )
                      }
                    >
                      No game
                    </button>{' '}
                    <button
                      className="gk-cp-btn is-small"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          () =>
                            call(`editorial-lists/entries/${e.id}/match`, 'POST', {
                              gameSlug: null,
                              queue: true,
                            }),
                          'Sent to the unmatched-games queue.',
                        )
                      }
                    >
                      To unmatched queue
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="gk-cp-card">
        <h2 className="gk-cp-card-title">Confirmed ({q.confirmed.length})</h2>
        <ListTable rows={q.confirmed} onOpen={(x) => void open(x)} />
        <details>
          <summary className="gk-cp-dim">Rejected ({q.rejected.length})</summary>
          <ListTable rows={q.rejected} onOpen={(x) => void open(x)} />
        </details>
      </section>

      <section className="gk-cp-card">
        <h2 className="gk-cp-card-title">Add a list by hand</h2>
        <div className="gk-nl-form">
          {(['outletName', 'sourceSlug', 'title', 'url', 'year'] as const).map((k) => (
            <label key={k} className="gk-nl-field">
              <span>
                {k}
                {k === 'sourceSlug' ? ' (optional)' : ''}
              </span>
              <input
                value={added[k]}
                onChange={(e) => setAdded({ ...added, [k]: e.target.value })}
              />
            </label>
          ))}
          <label className="gk-nl-field">
            <span>category</span>
            <select
              value={added.categoryKey}
              onChange={(e) => setAdded({ ...added, categoryKey: e.target.value })}
            >
              <option value="">—</option>
              {q.categories.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <div className="gk-nl-actions">
            <button
              className="gk-cp-btn is-primary"
              type="button"
              disabled={
                busy || !added.outletName.trim() || !added.title.trim() || !added.url.trim()
              }
              onClick={() =>
                void act(
                  () =>
                    call('editorial-lists', 'POST', {
                      outletName: added.outletName.trim(),
                      sourceSlug: added.sourceSlug.trim() || null,
                      title: added.title.trim(),
                      url: added.url.trim(),
                      year: added.year ? Number(added.year) : null,
                      categoryKey: added.categoryKey || null,
                    }),
                  'Added as a candidate — open it to add entries and confirm.',
                )
              }
            >
              Add list
            </button>
          </div>
        </div>
      </section>

      <section className="gk-cp-card">
        <h2 className="gk-cp-card-title">Consensus preview</h2>
        <p className="gk-cp-dim">
          Public from the minimum number of confirmed lists (Rules &amp; limits → Editorial lists).
          Pin / exclude games or hide a comparison line in{' '}
          <a className="gk-cp-link" href="/admin/curation">
            List curation
          </a>{' '}
          (page kind “lists”, page key “year:category”, e.g. “2023:best-of-year”): list “consensus”
          pins / excludes game slugs; list “comparison-lines” excludes “game-slug|soloTop”,
          “|coverage” or “|spread”. A game page can drop one list via page kind “game”, list
          “editorial-lists” (exclude the list id).
        </p>
        <div className="gk-nl-form">
          <label className="gk-nl-field">
            <span>Year · category</span>
            <select
              value={pair}
              onChange={async (e) => {
                setPair(e.target.value);
                const [y, c] = e.target.value.split(':');
                if (!y || !c) return;
                const r = await call(`editorial-lists/consensus/${y}/${c}`, 'GET');
                if (r.ok) setConsensus((r.json as { data: { rows: ConsensusRow[] } }).data.rows);
              }}
            >
              <option value="">—</option>
              {q.pairs.map((p) => (
                <option key={`${p.year}:${p.categoryKey}`} value={`${p.year}:${p.categoryKey}`}>
                  {p.label} {p.year} · {p.lists} lists · {p.isPublic ? 'public' : 'not public yet'}
                </option>
              ))}
            </select>
          </label>
          <div className="gk-nl-actions">
            <button
              className="gk-cp-btn"
              type="button"
              disabled={busy}
              onClick={() =>
                void act(() => call('editorial-lists/recompute', 'POST', {}), 'Recompute queued.')
              }
            >
              Recompute consensus
            </button>
          </div>
        </div>
        {consensus ? (
          <table className="gk-cp-table">
            <tbody>
              {consensus.map((r) => (
                <tr key={r.slug}>
                  <td>
                    {r.inConsensus ? (
                      `#${r.position}`
                    ) : (
                      <span className="gk-cp-dim">below minimum</span>
                    )}{' '}
                    <b>{r.name}</b>{' '}
                    <span className="gk-cp-dim">
                      · {r.appearances} lists · avg #{r.avgRank} ·{' '}
                      {r.positions.map((p) => `#${p.rank} ${p.outlet}`).join(', ')}
                    </span>
                    {r.lines.length ? (
                      <div className="gk-cp-dim">
                        {r.lines.map((l) => `${l.key}: ${l.text}`).join(' · ')}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <section className="gk-cp-card">
        <h2 className="gk-cp-card-title">Detection phrases</h2>
        <p className="gk-cp-dim">
          A feed title containing one of these becomes a candidate (lowercase, one per line).
        </p>
        <div className="gk-nl-form">
          <label className="gk-nl-field">
            <span>List phrases</span>
            <textarea
              rows={6}
              value={lex.patterns}
              onChange={(e) => setLex({ ...lex, patterns: e.target.value })}
            />
          </label>
          <label className="gk-nl-field">
            <span>Game of the Year phrases</span>
            <textarea
              rows={6}
              value={lex.goty}
              onChange={(e) => setLex({ ...lex, goty: e.target.value })}
            />
          </label>
          <div className="gk-nl-actions">
            <button
              className="gk-cp-btn"
              type="button"
              disabled={busy}
              onClick={() =>
                void act(
                  () =>
                    call('editorial-lists/lexicon', 'PUT', {
                      patterns: lex.patterns
                        .split('\n')
                        .map((x) => x.trim())
                        .filter(Boolean),
                      gotyPatterns: lex.goty
                        .split('\n')
                        .map((x) => x.trim())
                        .filter(Boolean),
                    }),
                  'Detection phrases saved (they apply to the next ingest).',
                )
              }
            >
              Save phrases
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
