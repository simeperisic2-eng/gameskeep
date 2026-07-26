import type { Metadata } from 'next';
import { listResource, rowLabel, findResource, getMeta } from '../lib';
import UnmatchedManager from '../_components/UnmatchedManager';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Admin · Unmatched games', robots: { index: false } };

export default async function UnmatchedPage() {
  const [meta, queue, games] = await Promise.all([
    getMeta(),
    listResource('unmatched-games'),
    listResource('games'),
  ]);
  const gameMeta = findResource(meta, 'games');

  const pending = queue
    .filter((r) => r.status === 'pending')
    .map((r) => ({
      id: String(r.id),
      rawName: String(r.rawName ?? ''),
      attempts: Number(r.attempts ?? 0),
      context: r.rawContext ? JSON.stringify(r.rawContext) : '',
    }));

  const resolvedCount = queue.filter((r) => r.status === 'resolved').length;
  const dismissedCount = queue.filter((r) => r.status === 'dismissed').length;

  const gameOptions = games
    .map((g) => ({ subjectId: String(g.subjectId ?? ''), label: rowLabel(gameMeta, g) }))
    .filter((g) => g.subjectId);

  return (
    <main className="gk-admin">
      <p className="gk-crumbs">
        <a href="/admin">Admin</a> / Unmatched games
      </p>
      <header className="gk-admin-head">
        <h1 className="gk-title" style={{ fontSize: 26 }}>
          Unmatched games <span className="gk-count">({pending.length} pending)</span>
        </h1>
      </header>
      <p className="gk-sub">
        The coverage safety net: references we couldn&apos;t auto-resolve (DB → provider) wait here
        for an editor. {resolvedCount} resolved · {dismissedCount} dismissed. Every action is
        audit-logged.
      </p>

      <UnmatchedManager items={pending} games={gameOptions} />
    </main>
  );
}
