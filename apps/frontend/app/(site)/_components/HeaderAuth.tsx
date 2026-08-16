'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost, fetchMe, resetCsrf, type MeUser } from '@/lib/client';

/**
 * Header auth affordance (SPEC I6, Slice 8): a signed-out visitor sees "Sign in";
 * a signed-in one sees a profile menu (level chip + username, with links to
 * their feed, public profile, account, and sign out). Client-hydrated so the
 * header markup stays cacheable and only this island is per-user.
 */
export function HeaderAuth(): React.JSX.Element {
  const router = useRouter();
  const [me, setMe] = useState<MeUser | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchMe().then(setMe);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  async function signOut(): Promise<void> {
    await apiPost('/api/auth/logout');
    resetCsrf();
    setMe(null);
    setOpen(false);
    router.push('/');
    router.refresh();
  }

  if (me === undefined) return <span className="gk-signin" aria-hidden />; // pre-hydration
  if (me === null) {
    return (
      <a className="gk-signin" href="/login">
        Sign in
      </a>
    );
  }

  return (
    <div className="gk-usermenu" ref={ref}>
      <button
        type="button"
        className="gk-usermenu-btn"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {/* Compact avatar shown only on mobile, where the name/level would overflow. */}
        <span className="gk-usermenu-ava" aria-hidden>
          {me.username.slice(0, 1).toUpperCase()}
        </span>
        {me.level ? <span className="gk-level-dot" aria-hidden /> : null}
        <span className="gk-usermenu-name">{me.username}</span>
        {me.level ? <span className="gk-usermenu-level">{me.level.label}</span> : null}
      </button>
      {open ? (
        <div className="gk-usermenu-pop" role="menu">
          <a href="/feed" role="menuitem">
            Your Feed
          </a>
          <a href={`/u/${me.username}`} role="menuitem">
            Public profile
          </a>
          <a href="/account" role="menuitem">
            Account
          </a>
          <button type="button" role="menuitem" onClick={signOut}>
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
