'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { isActivePath, navItems } from '@/lib/nav';
import { signOutMe, useMe } from '@/lib/me-store';
import { useSite } from './SiteProvider';

/**
 * The phone menu (≤ 760 px): main navigation, search and sign in / account.
 * WAI-ARIA disclosure pattern — the button carries `aria-expanded` +
 * `aria-controls`; the panel is a plain region that takes focus when it opens.
 * Escape closes it and returns focus to the button; it also closes on a
 * navigation, a tap outside, focus leaving it, and above the phone breakpoint.
 * Page scroll is locked while it is open; a dimmed backdrop takes the outside tap
 * so it closes the menu without also activating whatever lies underneath.
 */
const PANEL_ID = 'gk-mobilemenu';

export function MobileMenu(): React.JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  const { layout } = useSite();
  const me = useMe();
  // Open "at" a path: a navigation changes the path, which closes the menu.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt !== null && openAt === pathname;
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const items = navItems(layout.listsInNav);

  function close(returnFocus: boolean): void {
    setOpenAt(null);
    if (returnFocus) btnRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.classList.add('gk-menu-open');
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(true);
      }
    };
    const onPointer = (e: PointerEvent): void => {
      const t = e.target as Node | null;
      if (t && !panelRef.current?.contains(t) && !btnRef.current?.contains(t)) close(false);
    };
    const wide = window.matchMedia('(min-width: 761px)');
    const onWide = (): void => {
      if (wide.matches) close(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    wide.addEventListener('change', onWide);
    return () => {
      root.classList.remove('gk-menu-open');
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      wide.removeEventListener('change', onWide);
    };
  }, [open]);

  async function signOut(): Promise<void> {
    await signOutMe();
    close(false);
    router.push('/');
    router.refresh();
  }

  return (
    <>
      <button
        ref={btnRef}
        className="gk-burger"
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        aria-controls={PANEL_ID}
        onClick={() => (open ? close(false) : setOpenAt(pathname))}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
          {open ? (
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          ) : (
            <path
              d="M4 7h16M4 12h16M4 17h16"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          )}
        </svg>
      </button>
      <div
        className="gk-mobilemenu-backdrop"
        hidden={!open}
        aria-hidden
        onClick={() => close(false)}
      />
      <div
        id={PANEL_ID}
        ref={panelRef}
        className="gk-mobilemenu"
        role="region"
        aria-label="Menu"
        tabIndex={-1}
        hidden={!open}
        onBlur={(e) => {
          // Focus moved somewhere outside the menu (Tab past its end) → close.
          const next = e.relatedTarget as Node | null;
          if (next && !e.currentTarget.contains(next) && !btnRef.current?.contains(next)) {
            close(false);
          }
        }}
      >
        <form className="gk-mobilemenu-search" role="search" action="/search" method="get">
          <label htmlFor="gk-mobilemenu-q" className="gk-sr-only">
            Search games, stories and sources
          </label>
          <input
            id="gk-mobilemenu-q"
            type="search"
            name="q"
            maxLength={200}
            autoComplete="off"
            placeholder="Search games, stories and sources…"
          />
          <button type="submit" className="gk-btn-amber">
            Search
          </button>
        </form>

        <nav className="gk-mobilemenu-nav" aria-label="Main menu">
          <ul>
            {items.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  aria-current={isActivePath(pathname, item.href) ? 'page' : undefined}
                  onClick={() => close(false)}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="gk-mobilemenu-account">
          {me === undefined ? null : me === null ? (
            <>
              <a className="gk-btn-amber" href="/login" onClick={() => close(false)}>
                Sign in
              </a>
              <a className="gk-mobilemenu-secondary" href="/register" onClick={() => close(false)}>
                Create an account
              </a>
            </>
          ) : (
            <>
              <p className="gk-mobilemenu-who">
                Signed in as <b>{me.username}</b>
                {me.level ? <span className="gk-mobilemenu-level">{me.level.label}</span> : null}
              </p>
              <ul>
                <li>
                  <a href="/feed" onClick={() => close(false)}>
                    Your Feed
                  </a>
                </li>
                <li>
                  <a href={`/u/${encodeURIComponent(me.username)}`} onClick={() => close(false)}>
                    Public profile
                  </a>
                </li>
                <li>
                  <a href="/account" onClick={() => close(false)}>
                    Account
                  </a>
                </li>
              </ul>
              <button
                type="button"
                className="gk-mobilemenu-secondary"
                onClick={() => void signOut()}
              >
                Sign out
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
