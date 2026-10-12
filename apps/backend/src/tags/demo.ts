import { and, eq, like } from 'drizzle-orm';
import { isDemo } from '../config/env';
import { db } from '../db/client';
import { gameTags, gameTagVotes, games, subjects, tags, users } from '../db/schema';
import { writeAudit } from '../admin/audit';
import { recomputeGameTag } from './service';

/**
 * Demo-only tag activity (Phase P S3): the seeded "proven" community voters
 * (gk_voter1–8 — verified, reputable, joined long ago) report a few issues, so
 * the demo shows every state: an active confirmed issue, a resolved one with its
 * patch, a past one, and a report still waiting in the moderation queue. Real
 * engine, mock data: votes are rows, scores come from the same credibility
 * weighting, confirmations are marked `demo-seed`. Insert-if-absent: an editor's
 * later decision on any of these rows is never touched.
 */
const DAY = 86_400_000;

interface DemoIssue {
  game: string;
  tag: string;
  voters: number;
  /** Vote dates, days before boot. */
  votedDaysAgo: number[];
  confirmDaysAgo: number | null;
  resolved?: { daysAgo: number; patchRef: string };
}

const DEMO_ISSUES: DemoIssue[] = [
  // active: confirmed, fresh votes
  {
    game: 'helldivers-2',
    tag: 'server-problems',
    voters: 5,
    votedDaysAgo: [12, 9, 6, 4, 2],
    confirmDaysAgo: 8,
  },
  // resolved with a patch reference
  {
    game: 'cyberpunk-2077',
    tag: 'bugs',
    voters: 6,
    votedDaysAgo: [900, 890, 880, 870, 860, 850],
    confirmDaysAgo: 870,
    resolved: { daysAgo: 400, patchRef: 'Patch 2.0' },
  },
  // past: confirmed long ago, no fresh signal since
  {
    game: 'baldurs-gate-3',
    tag: 'bugs',
    voters: 4,
    votedDaysAgo: [140, 130, 125, 120],
    confirmDaysAgo: 118,
  },
  // waiting in the queue (below the threshold)
  { game: 'elden-ring', tag: 'cheaters', voters: 2, votedDaysAgo: [3, 1], confirmDaysAgo: null },
];

export async function seedDemoTagActivity(): Promise<number> {
  if (!isDemo()) return 0;
  const voters = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(like(users.username, 'gk\\_voter%'))
    .orderBy(users.username);
  if (voters.length === 0) return 0;
  const now = Date.now();
  let created = 0;
  for (const d of DEMO_ISSUES) {
    const [g] = await db
      .select({ id: games.id })
      .from(games)
      .innerJoin(subjects, eq(subjects.id, games.subjectId))
      .where(eq(subjects.slug, d.game))
      .limit(1);
    const [t] = await db.select({ id: tags.id }).from(tags).where(eq(tags.slug, d.tag)).limit(1);
    if (!g || !t) continue;
    const [existing] = await db
      .select({ id: gameTags.id })
      .from(gameTags)
      .where(and(eq(gameTags.gameId, g.id), eq(gameTags.tagId, t.id)))
      .limit(1);
    if (existing) continue; // provably not ours to touch (or already seeded)
    const chosen = voters.slice(0, d.voters);
    await db
      .insert(gameTagVotes)
      .values(
        chosen.map((v, i) => ({
          userId: v.id,
          gameId: g.id,
          tagId: t.id,
          createdAt: new Date(now - (d.votedDaysAgo[i] ?? 1) * DAY),
        })),
      )
      .onConflictDoNothing();
    const confirmed = d.confirmDaysAgo != null ? new Date(now - d.confirmDaysAgo * DAY) : null;
    const [row] = await db
      .insert(gameTags)
      .values({
        gameId: g.id,
        tagId: t.id,
        state: confirmed ? 'published' : 'pending',
        source: 'players',
        firstSeenAt: new Date(now - Math.max(...d.votedDaysAgo) * DAY),
        lastConfirmedAt: confirmed,
        confirmedByLabel: confirmed ? 'demo-seed' : null,
        resolvedAt: d.resolved ? new Date(now - d.resolved.daysAgo * DAY) : null,
        patchRef: d.resolved?.patchRef ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: gameTags.id });
    if (!row) continue;
    await recomputeGameTag(g.id, t.id);
    created += 1;
  }
  if (created) {
    await writeAudit({
      action: 'create',
      entityType: 'game-tag',
      entityId: 'demo-seed',
      changes: { created },
      summary: `demo tag activity: ${created} player-reported issue tag(s)`,
      actor: { label: 'system:demo-seed' },
    });
  }
  return created;
}
