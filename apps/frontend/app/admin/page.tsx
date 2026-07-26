import type { Metadata } from 'next';
import { getMeta } from './lib';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Admin · GamesKeep', robots: { index: false } };

// Group resources for a tidier index (purely presentational).
const GROUPS: { title: string; names: string[] }[] = [
  { title: 'Content', names: ['topics', 'articles', 'games', 'subjects', 'sources'] },
  {
    title: 'Game details',
    names: [
      'game-reviews',
      'game-critic-reviews',
      'game-external-ratings',
      'game-content-flags',
      'game-videos',
      'game-prices',
      'game-system-requirements',
      'game-player-counts',
      'game-user-ratings',
    ],
  },
  {
    title: 'Awards',
    names: ['award-editions', 'award-edition-categories', 'award-nominations', 'award-outcomes'],
  },
  { title: 'Users', names: ['users'] },
  { title: 'Catalog (I2)', names: ['unmatched-games'] },
  {
    title: 'Lists (extensible)',
    names: ['roles', 'user-levels', 'topic-types', 'source-types', 'badges', 'award-categories'],
  },
];

export default async function AdminHome() {
  const meta = await getMeta();
  const byName = new Map(meta.resources.map((r) => [r.name, r]));

  return (
    <main className="gk-admin">
      <header className="gk-admin-head">
        <h1 className="gk-title" style={{ fontSize: 30 }}>
          GamesKeep Admin
        </h1>
        <span className="gk-mode">GAME DATA · I2</span>
      </header>
      <p className="gk-sub">
        Basic CRUD for every model (the polished Control Panel is I8).{' '}
        <a href="/admin/relations">Manage relations →</a>{' '}
        <a href="/admin/unmatched">Unmatched games →</a>{' '}
        <a href="/admin/clustering">Topics &amp; clustering →</a>{' '}
        <a href="/admin/bias">Bias engine →</a> <a href="/admin/ratings">Rating engine →</a>
      </p>

      {GROUPS.map((group) => (
        <section key={group.title} className="gk-card" style={{ marginBottom: 18 }}>
          <h2 className="gk-card-title">{group.title}</h2>
          <ul className="gk-admin-grid">
            {group.names.map((name) => {
              const r = byName.get(name);
              if (!r) return null;
              return (
                <li key={name}>
                  <a className="gk-admin-link" href={`/admin/${name}`}>
                    {r.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <footer className="gk-foot">
        pgvector columns present:{' '}
        {meta.vectorColumns.length === 0
          ? 'none'
          : meta.vectorColumns.map((c) => `${c.table}.${c.column}`).join(', ')}
      </footer>
    </main>
  );
}
