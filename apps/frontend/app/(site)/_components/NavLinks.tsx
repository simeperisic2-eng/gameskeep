'use client';

import { usePathname } from 'next/navigation';
import { useSite } from './SiteProvider';

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
  // Phase P S4: "Lists" (editorial-list consensus) after Awards — an admin rule.
  const { layout } = useSite();
  const items = layout.listsInNav
    ? [...ITEMS.slice(0, 5), { href: '/lists', label: 'Lists' }, ...ITEMS.slice(5)]
    : ITEMS;
  return (
    <nav className="gk-nav" aria-label="Primary">
      {items.map((item) => {
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
