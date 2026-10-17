'use client';

import { useState } from 'react';
import { adminFetch } from '../_lib/adminFetch';
import type {
  AdminCommunityNote,
  AdminNoteSource,
  AdminSteamSummary,
  CommunityVoiceData,
} from '../lib';

/**
 * Community voice (Phase P S5, moderator+) — per game:
 *  - the editor note "What the community says": draft (text, source links, as-of),
 *    "Polish with AI" (or check a rewrite made elsewhere) → the validator's verdict
 *    + the diff → Accept / Discard → Publish. A rewrite that adds a number, a name
 *    or a link can never be accepted; you can always edit and publish by hand.
 *  - the Steam reviews summary: hide, approve the automatic text, write your own,
 *    back to automatic — and "Run now" (a background job).
 */
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
    const issues = json.issues as { message?: string; path?: unknown[] }[] | undefined;
    json.message =
      issues?.map((i) => `${(i.path ?? []).join('.')}: ${i.message}`).join('; ') ||
      `HTTP ${res.status}`;
  }
  return { ok: res.ok, json };
}

const STATE_TEXT: Record<AdminSteamSummary['publicState'], string> = {
  'shown-ai': 'Shown — labelled “AI summary”',
  'shown-editorial': 'Shown — editorial (approved / your text)',
  'below-threshold': 'Not shown — below the review threshold',
  hidden: 'Hidden by an editor',
  'no-text': 'Not shown — no safe automatic text',
};

export function CommunityVoiceManager({
  initial,
}: {
  initial: CommunityVoiceData;
}): React.JSX.Element {
  const [data, setData] = useState(initial);
  const [slug, setSlug] = useState('');
  const [note, setNote] = useState<AdminCommunityNote | null>(null);
  const [steam, setSteam] = useState<AdminSteamSummary | null>(null);
  const [text, setText] = useState('');
  const [sources, setSources] = useState<AdminNoteSource[]>([{ url: '' }]);
  const [asOf, setAsOf] = useState('');
  const [pasted, setPasted] = useState('');
  const [steamText, setSteamText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reloadList(): Promise<void> {
    const r = await call('community-voice', 'GET');
    if (r.ok) setData((r.json as { data: CommunityVoiceData }).data);
  }
  async function open(s: string): Promise<void> {
    const target = s.trim().toLowerCase();
    if (!target) return;
    const r = await call(`community-voice/${encodeURIComponent(target)}`, 'GET');
    if (!r.ok) {
      setMsg(String(r.json.message));
      return;
    }
    const d = (r.json as { data: { note: AdminCommunityNote; steam: AdminSteamSummary | null } })
      .data;
    setSlug(target);
    setNote(d.note);
    setSteam(d.steam);
    setText(d.note.text);
    setSources(d.note.sources.length ? d.note.sources : [{ url: '' }]);
    setAsOf(d.note.asOf ?? '');
    setSteamText(d.steam?.editedText ?? '');
    setPasted('');
    setMsg(null);
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
        ? `${done}${r.json.jobId ? ` (job ${String(r.json.jobId)})` : ''}`
        : `Not done: ${String(r.json.message)}`,
    );
    if (r.ok) {
      await reloadList();
      if (slug) await open(slug);
    }
  }
  const cleanSources = (): AdminNoteSource[] =>
    sources
      .map((s) => ({ url: s.url.trim(), ...(s.label?.trim() ? { label: s.label.trim() } : {}) }))
      .filter((s) => s.url);
  const draftBody = () => ({ text, sources: cleanSources(), asOf: asOf || null });
  const enc = encodeURIComponent(slug);

  return (
    <div className="gk-cp-page">
      <header className="gk-cp-page-head">
        <h1 className="gk-cp-page-title">Community voice</h1>
        <p className="gk-cp-page-sub">
          “What the community says” on game pages: your note (2–3 sentences, at least one source
          link, as-of date, your name) and the Steam reviews summary. AI may only tidy your words —
          every rewrite is checked for numbers, names and links that are not in your text.
        </p>
      </header>
      {msg && <div className="gk-cp-note gk-cp-flash">{msg}</div>}

      <section className="gk-cp-card">
        <div className="gk-nl-form">
          <label className="gk-nl-field">
            <span>Game (slug)</span>
            <input
              list="gk-cv-games"
              value={slug}
              placeholder="e.g. baldurs-gate-3"
              onChange={(e) => setSlug(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void open(slug);
              }}
            />
            <datalist id="gk-cv-games">
              {[
                ...new Set([...data.notes.map((n) => n.slug), ...data.steam.map((s) => s.slug)]),
              ].map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <div className="gk-nl-actions">
            <button className="gk-cp-btn is-primary" type="button" onClick={() => void open(slug)}>
              Open
            </button>
          </div>
        </div>
        {data.notes.length ? (
          <table className="gk-cp-table" data-cv-notes>
            <tbody>
              {data.notes.map((n) => (
                <tr key={n.slug}>
                  <td>
                    <b>{n.name}</b>{' '}
                    <span className="gk-cp-dim">
                      · {n.status}
                      {n.editor ? ` · ${n.editor}` : ''}
                    </span>
                  </td>
                  <td>
                    <button
                      className="gk-cp-btn is-small"
                      type="button"
                      onClick={() => void open(n.slug)}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="gk-cp-dim">No notes yet — open a game to write one.</p>
        )}
      </section>

      {note ? (
        <section className="gk-cp-card" data-cv-editor>
          <h2 className="gk-cp-card-title">
            {note.game.name} — editor note <span className="gk-cp-dim">· {note.status}</span>
          </h2>
          {note.published ? (
            <div className="gk-cp-note">
              <b>Live on the page:</b> {note.published.text}
              {note.publishedAt ? <span className="gk-cp-dim"> · by {note.editor}</span> : null}
            </div>
          ) : null}
          <label className="gk-nl-field gk-nl-field-wide">
            <span>Your note</span>
            <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          {sources.map((s, i) => (
            <div key={i} className="gk-nl-form">
              <label className="gk-nl-field">
                <span>Source link {i + 1}</span>
                <input
                  value={s.url}
                  placeholder="https://…"
                  onChange={(e) =>
                    setSources(sources.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
                  }
                />
              </label>
              <label className="gk-nl-field">
                <span>Label (optional)</span>
                <input
                  value={s.label ?? ''}
                  onChange={(e) =>
                    setSources(
                      sources.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                    )
                  }
                />
              </label>
            </div>
          ))}
          <div className="gk-nl-actions">
            {sources.length < 5 ? (
              <button
                className="gk-cp-btn is-small"
                type="button"
                onClick={() => setSources([...sources, { url: '' }])}
              >
                + Source
              </button>
            ) : null}
          </div>
          <label className="gk-nl-field">
            <span>As of (date)</span>
            <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </label>
          <div className="gk-nl-actions">
            <button
              className="gk-cp-btn"
              type="button"
              disabled={busy}
              onClick={() =>
                void act(
                  () => call(`community-voice/${enc}/note`, 'PUT', draftBody()),
                  'Draft saved.',
                )
              }
            >
              Save draft
            </button>{' '}
            <button
              className="gk-cp-btn"
              type="button"
              disabled={busy || !text.trim()}
              onClick={() =>
                void act(
                  () => call(`community-voice/${enc}/polish`, 'POST', { text }),
                  'Polish ready — check the diff below.',
                )
              }
            >
              Polish with AI
            </button>{' '}
            <button
              className="gk-cp-btn is-primary"
              type="button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const saved = await call(`community-voice/${enc}/note`, 'PUT', draftBody());
                  if (!saved.ok) return saved;
                  return call(`community-voice/${enc}/publish`, 'POST', {});
                }, 'Published.')
              }
            >
              Save &amp; publish
            </button>{' '}
            {note.status === 'published' ? (
              <button
                className="gk-cp-btn"
                type="button"
                disabled={busy}
                onClick={() =>
                  void act(
                    () => call(`community-voice/${enc}/unpublish`, 'POST', {}),
                    'Unpublished.',
                  )
                }
              >
                Unpublish
              </button>
            ) : null}
          </div>
          <details>
            <summary className="gk-cp-dim">Check a rewrite made elsewhere</summary>
            <label className="gk-nl-field gk-nl-field-wide">
              <span>Paste the rewrite — it is checked against your note above</span>
              <textarea rows={3} value={pasted} onChange={(e) => setPasted(e.target.value)} />
            </label>
            <button
              className="gk-cp-btn is-small"
              type="button"
              disabled={busy || !pasted.trim() || !text.trim()}
              onClick={() =>
                void act(
                  () => call(`community-voice/${enc}/polish`, 'POST', { text, candidate: pasted }),
                  'Checked.',
                )
              }
            >
              Check it
            </button>
          </details>

          {note.polish ? (
            <div
              className={`gk-cp-note ${note.polish.ok ? '' : 'is-warn'}`}
              data-polish={note.polish.ok ? 'ok' : 'rejected'}
            >
              <b>
                {note.polish.ok
                  ? 'The rewrite adds nothing new.'
                  : 'Rejected — the rewrite adds claims that are not in your text:'}
              </b>
              {note.polish.issues.length ? (
                <ul>
                  {note.polish.issues.map((i, k) => (
                    <li key={k}>
                      new {i.kind}: <code>{i.token}</code>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="gk-cv-diff">
                {note.polish.diff.map((d, k) =>
                  d.op === 'same' ? (
                    <span key={k}>{d.text} </span>
                  ) : d.op === 'add' ? (
                    <ins key={k}>{d.text} </ins>
                  ) : (
                    <del key={k}>{d.text} </del>
                  ),
                )}
              </p>
              <span className="gk-cp-dim">
                {note.polish.provider ? `by ${note.polish.provider}` : ''}
              </span>
              <div className="gk-nl-actions">
                <button
                  className="gk-cp-btn is-primary"
                  type="button"
                  disabled={busy || !note.polish.ok}
                  onClick={() =>
                    void act(
                      () => call(`community-voice/${enc}/polish/accept`, 'POST', {}),
                      'Rewrite accepted — review it, then publish.',
                    )
                  }
                >
                  Use this rewrite
                </button>{' '}
                <button
                  className="gk-cp-btn"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => call(`community-voice/${enc}/polish/discard`, 'POST', {}),
                      'Discarded.',
                    )
                  }
                >
                  Discard
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {note ? (
        <section className="gk-cp-card" data-cv-steam>
          <h2 className="gk-cp-card-title">{note.game.name} — Steam reviews summary</h2>
          {steam ? (
            <>
              <p className="gk-cp-dim">
                {steam.reviewCount} reviews in the last {steam.windowDays} days
                {steam.positivePct != null ? ` · ${steam.positivePct}% positive` : ''} ·{' '}
                {STATE_TEXT[steam.publicState]}
                {steam.approvedBy ? ` · approved by ${steam.approvedBy}` : ''}
              </p>
              <p>
                <b>Automatic text:</b>{' '}
                {steam.summaryText ?? <span className="gk-cp-dim">none</span>}
              </p>
              <label className="gk-nl-field gk-nl-field-wide">
                <span>Your text instead (editorial — no AI label)</span>
                <textarea
                  rows={3}
                  value={steamText}
                  onChange={(e) => setSteamText(e.target.value)}
                />
              </label>
              <div className="gk-nl-actions">
                <button
                  className="gk-cp-btn"
                  type="button"
                  disabled={busy || !steamText.trim()}
                  onClick={() =>
                    void act(
                      () =>
                        call(`community-voice/${enc}/steam`, 'POST', { text: steamText.trim() }),
                      'Saved.',
                    )
                  }
                >
                  Save my text
                </button>{' '}
                <button
                  className="gk-cp-btn"
                  type="button"
                  disabled={busy || !steam.summaryText}
                  onClick={() =>
                    void act(
                      () => call(`community-voice/${enc}/steam`, 'POST', { approve: true }),
                      'Approved as editorial.',
                    )
                  }
                >
                  Approve automatic text
                </button>{' '}
                {steam.editedText ? (
                  <button
                    className="gk-cp-btn"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () => call(`community-voice/${enc}/steam`, 'POST', { text: null }),
                        'Back to automatic.',
                      )
                    }
                  >
                    Back to automatic
                  </button>
                ) : null}{' '}
                <button
                  className="gk-cp-btn"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => call(`community-voice/${enc}/steam`, 'POST', { hidden: !steam.hidden }),
                      steam.hidden ? 'Shown again.' : 'Hidden.',
                    )
                  }
                >
                  {steam.hidden ? 'Show' : 'Hide'}
                </button>
              </div>
            </>
          ) : (
            <p className="gk-cp-dim">
              No Steam summary for this game yet (no Steam app id, or the job has not run).
            </p>
          )}
          <div className="gk-nl-actions">
            <button
              className="gk-cp-btn is-small"
              type="button"
              disabled={busy}
              onClick={() =>
                void act(
                  () => call('community-voice/steam/run', 'POST', {}),
                  'Steam summaries queued',
                )
              }
            >
              Run the Steam job now
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
