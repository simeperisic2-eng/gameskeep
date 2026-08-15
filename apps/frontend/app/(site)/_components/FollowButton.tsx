'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Follow / Unfollow toggle (SPEC I6, Slice 6). A small client island: on mount
 * it asks the community BFF whether the signed-in user follows this entity; a
 * signed-out visitor gets a link to sign in. The mutation double-submits a CSRF
 * token (fetched from /api/auth/csrf) — same-origin, so it works with SameSite.
 * The surrounding page stays server-rendered + cacheable; only this button is
 * per-user (hydrated client-side).
 */
type State = 'loading' | 'guest' | 'following' | 'not';

export function FollowButton({
  entityType,
  slug,
}: {
  entityType: 'game' | 'topic';
  slug: string;
}): React.JSX.Element {
  const [state, setState] = useState<State>('loading');
  const [busy, setBusy] = useState(false);
  const base = `/api/community/follow/${entityType}/${slug}`;

  useEffect(() => {
    let live = true;
    fetch(base, { cache: 'no-store' })
      .then(async (r) => {
        if (!live) return;
        if (r.status === 401) return setState('guest');
        const b = (await r.json().catch(() => null)) as { data?: { following?: boolean } } | null;
        setState(b?.data?.following ? 'following' : 'not');
      })
      .catch(() => live && setState('guest'));
    return () => {
      live = false;
    };
  }, [base]);

  const toggle = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const csrf = await fetch('/api/auth/csrf', { cache: 'no-store' })
        .then((r) => r.json())
        .then((b: { token?: string }) => b.token)
        .catch(() => undefined);
      const method = state === 'following' ? 'DELETE' : 'POST';
      const r = await fetch(base, {
        method,
        headers: csrf ? { 'x-csrf-token': csrf } : {},
        cache: 'no-store',
      });
      if (r.status === 401) {
        setState('guest');
        return;
      }
      if (r.ok) {
        const b = (await r.json().catch(() => null)) as { data?: { following?: boolean } } | null;
        setState(b?.data?.following ? 'following' : 'not');
      }
    } finally {
      setBusy(false);
    }
  }, [base, busy, state]);

  if (state === 'loading') {
    return (
      <span className="gk-follow-btn is-loading" aria-hidden>
        ＋ Follow
      </span>
    );
  }
  if (state === 'guest') {
    return (
      <a className="gk-follow-btn" href="/account">
        ＋ Follow
      </a>
    );
  }
  const following = state === 'following';
  return (
    <button
      type="button"
      className={`gk-follow-btn${following ? ' is-following' : ''}`}
      onClick={toggle}
      disabled={busy}
      aria-pressed={following}
    >
      {following ? '✓ Following' : '＋ Follow'}
    </button>
  );
}
