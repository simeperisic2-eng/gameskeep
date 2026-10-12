'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiDelete, apiPost, fetchMe } from '@/lib/client';

/**
 * Reader tag voting (Phase P S3). Verified readers vote on EXISTING taxonomy
 * tags — one vote per tag per game, withdrawable. A tag becomes public only once
 * its credibility-weighted score reaches the threshold AND an editor confirms; a
 * new name goes to the review queue, never live. All writes go through the
 * community BFF (CSRF + verified + per-user limit server-side).
 */
interface TagOption {
  slug: string;
  name: string;
  family: 'content' | 'issue';
}

export function TagVoting({ gameSlug }: { gameSlug: string }): React.JSX.Element | null {
  const [options, setOptions] = useState<TagOption[]>([]);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [signedIn, setSignedIn] = useState(false);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [name, setName] = useState('');
  const base = `/api/community/tags/${encodeURIComponent(gameSlug)}`;

  const load = useCallback(async () => {
    const me = await fetchMe();
    setSignedIn(Boolean(me));
    setVerified(Boolean(me?.isEmailVerified));
    const r = await fetch(base, { cache: 'no-store' });
    if (!r.ok) return;
    const b = (await r.json()) as { data?: { tags: TagOption[]; mine: string[] } };
    if (b.data) {
      setOptions(b.data.tags);
      setMine(new Set(b.data.mine));
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(slug: string): Promise<void> {
    setBusy(true);
    setMsg(null);
    const on = mine.has(slug);
    const r = on
      ? await apiDelete(`${base}/${encodeURIComponent(slug)}/vote`)
      : await apiPost(`${base}/${encodeURIComponent(slug)}/vote`);
    setBusy(false);
    if (!r.ok) {
      setMsg(r.message ?? 'Could not save your vote — please retry.');
      return;
    }
    const next = new Set(mine);
    if (on) next.delete(slug);
    else next.add(slug);
    setMine(next);
  }

  async function suggest(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const r = await apiPost<{ status: string; tagSlug?: string }>(`${base}/suggest`, {
      name: name.trim(),
    });
    setBusy(false);
    if (!r.ok) {
      setMsg(r.message ?? 'Could not send the suggestion — please retry.');
      return;
    }
    if (r.data?.status === 'exists') {
      const known = options.find((o) => o.slug === r.data?.tagSlug);
      setMsg(`“${known?.name ?? r.data.tagSlug}” already exists — vote for it above.`);
    } else {
      setMsg('Thanks — your suggestion is waiting for an editor.');
      setName('');
    }
  }

  if (options.length === 0) return null;
  const group = (family: TagOption['family']): TagOption[] =>
    options.filter((o) => o.family === family);

  return (
    <div className="gk-tagvote">
      <h3 className="gk-gametags-h">Tag this game</h3>
      {!signedIn ? (
        <p className="gk-section-sub" style={{ margin: 0 }}>
          <a href="/login">Sign in</a> to tag this game.
        </p>
      ) : !verified ? (
        <p className="gk-section-sub" style={{ margin: 0 }}>
          Verify your email to tag games.
        </p>
      ) : (
        <>
          {(['content', 'issue'] as const).map((fam) =>
            group(fam).length ? (
              <div key={fam} className="gk-tagvote-group">
                <span className="gk-tagvote-label">{fam === 'content' ? 'Content' : 'Issues'}</span>
                <div className="gk-tagvote-options">
                  {group(fam).map((o) => (
                    <button
                      key={o.slug}
                      type="button"
                      className={`gk-tagvote-btn${mine.has(o.slug) ? ' is-on' : ''}`}
                      aria-pressed={mine.has(o.slug)}
                      disabled={busy}
                      onClick={() => void toggle(o.slug)}
                    >
                      {o.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null,
          )}
          <form className="gk-tagvote-suggest" onSubmit={(e) => void suggest(e)}>
            <label className="gk-tagvote-label" htmlFor={`tag-suggest-${gameSlug}`}>
              Missing a tag?
            </label>
            <input
              id={`tag-suggest-${gameSlug}`}
              value={name}
              maxLength={60}
              placeholder="Suggest a name"
              onChange={(e) => setName(e.target.value)}
            />
            <button className="gk-tagvote-btn" type="submit" disabled={busy || !name.trim()}>
              Suggest
            </button>
          </form>
        </>
      )}
      {msg ? (
        <p className="gk-section-sub" role="status" style={{ margin: 0 }}>
          {msg}
        </p>
      ) : null}
    </div>
  );
}
