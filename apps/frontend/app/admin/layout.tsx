import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import './admin.css';
import { AdminSignOut } from './_lib/AdminSignOut';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Control Panel · GamesKeep', robots: { index: false } };

/**
 * Control Panel shell (SPEC I8, Slice 1). The panel is now behind STAFF-SESSION
 * auth — a non-staff visitor is redirected to login (the retired token-proxy no
 * longer grants blanket access). The nav is RBAC-FILTERED by the logged-in
 * staff's rank, matching the backend section gating (moderator 30 < admin 40 <
 * owner 50), so a moderator never sees a link the backend would 403.
 */
const NAV: {
  title: string;
  minRank: number;
  items: { label: string; href: string; minRank: number }[];
}[] = [
  {
    title: 'Overview',
    minRank: 30,
    items: [{ label: 'Dashboard', href: '/admin', minRank: 30 }],
  },
  {
    title: 'Moderation & content',
    minRank: 30,
    items: [
      { label: 'Topics', href: '/admin/topics', minRank: 30 },
      { label: 'Articles', href: '/admin/articles', minRank: 30 },
      { label: 'Topics & clustering', href: '/admin/clustering', minRank: 30 },
      { label: 'Relations', href: '/admin/relations', minRank: 30 },
    ],
  },
  {
    title: 'Catalog & engines',
    minRank: 40,
    items: [
      { label: 'Games', href: '/admin/games', minRank: 40 },
      { label: 'Sources', href: '/admin/sources', minRank: 40 },
      { label: 'Rating engine', href: '/admin/ratings', minRank: 40 },
      { label: 'Bias engine', href: '/admin/bias', minRank: 40 },
      { label: 'Unmatched games', href: '/admin/unmatched', minRank: 40 },
    ],
  },
  {
    title: 'Game details',
    minRank: 40,
    items: [
      { label: 'Subjects', href: '/admin/subjects', minRank: 40 },
      { label: 'Our reviews', href: '/admin/game-reviews', minRank: 40 },
      { label: 'Critic reviews', href: '/admin/game-critic-reviews', minRank: 40 },
      { label: 'External ratings', href: '/admin/game-external-ratings', minRank: 40 },
      { label: 'Content flags', href: '/admin/game-content-flags', minRank: 40 },
      { label: 'Videos', href: '/admin/game-videos', minRank: 40 },
      { label: 'Prices', href: '/admin/game-prices', minRank: 40 },
      { label: 'System requirements', href: '/admin/game-system-requirements', minRank: 40 },
      { label: 'Player counts', href: '/admin/game-player-counts', minRank: 40 },
      { label: 'User ratings', href: '/admin/game-user-ratings', minRank: 40 },
    ],
  },
  {
    title: 'Awards',
    minRank: 40,
    items: [
      { label: 'Editions', href: '/admin/award-editions', minRank: 40 },
      { label: 'Edition categories', href: '/admin/award-edition-categories', minRank: 40 },
      { label: 'Nominations', href: '/admin/award-nominations', minRank: 40 },
      { label: 'Outcomes', href: '/admin/award-outcomes', minRank: 40 },
    ],
  },
  {
    title: 'Advertising',
    minRank: 40,
    items: [
      { label: 'Inventory & analytics', href: '/admin/ads', minRank: 40 },
      { label: 'Placements', href: '/admin/ad-placements', minRank: 40 },
      { label: 'Ad slots', href: '/admin/ad-slots', minRank: 40 },
    ],
  },
  {
    title: 'Newsletter',
    minRank: 40,
    items: [{ label: 'Campaigns & subscribers', href: '/admin/newsletter', minRank: 40 }],
  },
  {
    title: 'Config & lists',
    minRank: 40,
    items: [
      { label: 'Lists & slots', href: '/admin/lists', minRank: 40 },
      { label: 'User levels', href: '/admin/user-levels', minRank: 40 },
      { label: 'Badges', href: '/admin/badges', minRank: 40 },
      { label: 'Topic types', href: '/admin/topic-types', minRank: 40 },
      { label: 'Source types', href: '/admin/source-types', minRank: 40 },
      { label: 'Award categories', href: '/admin/award-categories', minRank: 40 },
    ],
  },
  {
    title: 'Identity',
    minRank: 50,
    items: [
      { label: 'Users', href: '/admin/users', minRank: 50 },
      { label: 'Roles', href: '/admin/roles', minRank: 50 },
    ],
  },
];

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}): Promise<React.JSX.Element> {
  const user = await getSessionUser();
  if (!user || !user.role.isStaff) redirect('/login?next=/admin');
  const rank = user.role.rank;

  const groups = NAV.filter((g) => rank >= g.minRank).map((g) => ({
    ...g,
    items: g.items.filter((it) => rank >= it.minRank),
  }));

  return (
    <div className="gk-cp">
      <aside className="gk-cp-nav">
        <div className="gk-cp-brand">
          <a href="/admin">
            GamesKeep <b>Control</b>
          </a>
          <span className="gk-cp-brand-sub">Panel · I8</span>
        </div>
        <nav>
          {groups.map((g) => (
            <div key={g.title} className="gk-cp-navgroup">
              <span className="gk-cp-navgroup-title">{g.title}</span>
              <ul>
                {g.items.map((it) => (
                  <li key={it.href}>
                    <a href={it.href}>{it.label}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <div className="gk-cp-main">
        <header className="gk-cp-top">
          <span className="gk-cp-top-hint">
            Staff Control Panel — every action is audit-logged.
          </span>
          <div className="gk-cp-user">
            <span className="gk-cp-whoami">
              {user.username} · <b>{user.role.label}</b>
            </span>
            <a className="gk-cp-link" href="/">
              View site ↗
            </a>
            <AdminSignOut />
          </div>
        </header>
        <main className="gk-cp-content">{children}</main>
      </div>
    </div>
  );
}
