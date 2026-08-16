'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiPost, fetchMe } from '@/lib/client';

/**
 * Comments (SPEC I6, Slice 8, decision 8) — plain text, VERIFIED-gated writes,
 * post-moderation. Bodies are rendered as React children ({c.body}), so React
 * auto-escapes them: a stored `<script>` shows as INERT TEXT, never executed.
 * There is deliberately NO dangerouslySetInnerHTML anywhere near UGC.
 */
interface PublicComment {
  id: string;
  parentId: string | null;
  body: string;
  username: string;
  createdAt: string;
}

export function Comments({
  entityType,
  entityId,
  title = 'Discussion',
  initial,
}: {
  entityType: 'game' | 'topic' | 'article';
  entityId: string;
  title?: string;
  /** SSR-fetched comments — rendered in the initial HTML (escaped) then kept fresh. */
  initial?: PublicComment[];
}): React.JSX.Element {
  const [list, setList] = useState<PublicComment[] | null>(initial ?? null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const base = `/api/community/comment/${entityType}/${entityId}`;

  const load = useCallback(async () => {
    const r = await fetch(base, { cache: 'no-store' });
    if (r.ok) {
      const b = (await r.json()) as { data?: PublicComment[] };
      setList(b.data ?? []);
    } else {
      setList([]);
    }
  }, [base]);

  useEffect(() => {
    void load();
    fetchMe().then((me) => {
      setSignedIn(Boolean(me));
      setVerified(me ? me.isEmailVerified : null);
    });
  }, [load]);

  const post = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!body.trim() || busy) return;
      setBusy(true);
      setErr(null);
      const r = await apiPost(base, { body });
      setBusy(false);
      if (r.ok) {
        setBody('');
        await load();
      } else if (r.status === 403 && r.error === 'email_unverified') {
        setErr('Verify your email to comment.');
      } else if (r.status === 429) {
        setErr('You’re commenting too fast — slow down a moment.');
      } else {
        setErr('Could not post — please retry.');
      }
    },
    [base, body, busy, load],
  );

  return (
    <div className="gk-comments">
      <h3 className="gk-comments-title">
        {title}
        {list ? <span className="gk-comments-count"> · {list.length}</span> : null}
      </h3>

      {signedIn && verified ? (
        <form className="gk-comment-form" onSubmit={post}>
          <textarea
            className="gk-input gk-textarea"
            placeholder="Add your take…"
            value={body}
            maxLength={4000}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="gk-comment-form-actions">
            {err ? <span className="gk-form-error">{err}</span> : <span />}
            <button className="gk-btn-amber" type="submit" disabled={busy || !body.trim()}>
              {busy ? 'Posting…' : 'Post'}
            </button>
          </div>
        </form>
      ) : (
        <p className="gk-comments-gate">
          {signedIn ? (
            <>Verify your email to join the discussion.</>
          ) : (
            <>
              <a href="/login">Sign in</a> to join the discussion.
            </>
          )}
        </p>
      )}

      {list && list.length > 0 ? (
        <ul className="gk-comment-list">
          {list.map((c) => (
            <li key={c.id} className="gk-comment">
              <div className="gk-comment-head">
                <a href={`/u/${c.username}`} className="gk-comment-author">
                  {c.username}
                </a>
                <time className="gk-comment-time">
                  {new Date(c.createdAt).toLocaleDateString()}
                </time>
              </div>
              {/* React escapes this — a <script> body renders as inert text. */}
              <p className="gk-comment-body">{c.body}</p>
            </li>
          ))}
        </ul>
      ) : list ? (
        <p className="gk-comments-empty">No comments yet — be the first.</p>
      ) : (
        <p className="gk-form-quiet">Loading…</p>
      )}
    </div>
  );
}
