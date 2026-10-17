/**
 * Navigation helpers (I6 security review #3 — open-redirect guard).
 */

/**
 * Only follow a SAME-SITE relative `next`. Rejects absolute URLs
 * (`https://evil.com`), protocol-relative (`//evil.com`) and backslash tricks
 * (`/\evil.com`, which some browsers normalize to `//`), so a `?next=` param
 * can never redirect off-site after login. Anything invalid → `/feed`.
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/feed';
  return raw;
}

/** The site's main navigation (desktop bar + the phone menu share it). */
export interface NavItem {
  href: string;
  label: string;
}
const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Home' },
  { href: '/games', label: 'Games' },
  { href: '/topics', label: 'Topics' },
  { href: '/upcoming', label: 'Upcoming' },
  { href: '/awards', label: 'Awards' },
  { href: '/sources', label: 'Sources' },
  { href: '/feed', label: 'Feed' },
];

/** The nav items; "Lists" (Phase P S4) after Awards when the admin rule says so. */
export function navItems(listsInNav: boolean): NavItem[] {
  return listsInNav
    ? [...NAV_ITEMS.slice(0, 5), { href: '/lists', label: 'Lists' }, ...NAV_ITEMS.slice(5)]
    : [...NAV_ITEMS];
}

/** Is `href` the current section? "/" only on the homepage; others by path segment. */
export function isActivePath(pathname: string | null | undefined, href: string): boolean {
  const p = pathname ?? '';
  if (href === '/') return p === '/';
  return p === href || p.startsWith(`${href}/`);
}
