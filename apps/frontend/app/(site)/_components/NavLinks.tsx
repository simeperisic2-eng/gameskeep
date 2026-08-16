'use client';

import { usePathname } from 'next/navigation';

/**
 * Primary nav (BLUEPRINT 3 global nav): Home / Games / Topics / Upcoming /
 * Awards / Sources. All links exist now; sections built in later phases degrade
 * gracefully to an in-chrome "arriving soon" page rather than a dead link.
 */
const ITEMS: { href: string; label: string }[] = [
  { href: '/', label: 'Home' },
  { href: '/games', label: 'Games' },
  { href: '/topics', label: 'Topics' },
  { href: '/upcoming', label: 'Upcoming' },
  { href: '/awards', label: 'Awards' },
  { href: '/sources', label: 'Sources' },
  { href: '/feed', label: 'Feed' },
];

export function NavLinks(): React.JSX.Element {
  const pathname = usePathname();
  return (
    <nav className="gk-nav" aria-label="Primary">
      {ITEMS.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <a key={item.href} href={item.href} aria-current={active ? 'page' : undefined}>
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}
