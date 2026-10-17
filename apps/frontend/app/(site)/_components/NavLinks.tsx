'use client';

import { usePathname } from 'next/navigation';
import { isActivePath, navItems } from '@/lib/nav';
import { useSite } from './SiteProvider';

/**
 * Primary nav (BLUEPRINT 3 global nav): Home / Games / Topics / Upcoming /
 * Awards / Sources. All links exist now; sections built in later phases degrade
 * gracefully to an in-chrome "arriving soon" page rather than a dead link.
 */
export function NavLinks(): React.JSX.Element {
  const pathname = usePathname();
  // Phase P S4: "Lists" (editorial-list consensus) after Awards — an admin rule.
  const { layout } = useSite();
  const items = navItems(layout.listsInNav);
  return (
    <nav className="gk-nav" aria-label="Primary">
      {items.map((item) => {
        const active = isActivePath(pathname, item.href);
        return (
          <a key={item.href} href={item.href} aria-current={active ? 'page' : undefined}>
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}
