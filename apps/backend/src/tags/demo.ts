import { and, eq, inArray, like, notInArray, sql } from 'drizzle-orm';
import { isDemo } from '../config/env';
import { db } from '../db/client';
import {
  appSettings,
  auditLogs,
  gameTags,
  gameTagVotes,
  games,
  subjects,
  tags,
  users,
} from '../db/schema';
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
    await db
      .insert(appSettings)
      .values({ key: DEMO_TAGS_ANCHOR_KEY, value: { at: new Date(now).toISOString() } })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: { at: new Date(now).toISOString() }, updatedAt: new Date() },
      });
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

/** When the demo tag activity was last aligned (its dates are relative to this). */
export const DEMO_TAGS_ANCHOR_KEY = 'demo-tags-anchor';
/** Smaller shifts are noise (a quick restart). */
const MIN_SHIFT_MS = 60 * 60 * 1000;

/**
 * Demo only (Phase P S3b): keep the seeded tag activity relative to BOOT, like
 * the mock feed and the player history — otherwise "active" drifts into "past"
 * as real days pass. Every date of a still-untouched demo row (and its seeded
 * votes) moves by the time since the anchor. A row any staff member acted on
 * (a non-system audit entry) is never moved.
 */
export async function realignDemoTagDates(): Promise<{
  shiftedRows: number;
  hours: number;
} | null> {
  if (!isDemo()) return null;
  const [anchor] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, DEMO_TAGS_ANCHOR_KEY))
    .limit(1);
  let at = Date.parse(String((anchor?.value as { at?: unknown } | null)?.at ?? ''));
  if (!Number.isFinite(at)) {
    // A volume seeded before the anchor existed: its dates are relative to the
    // seed itself — the time of the system seed's audit row.
    const [seeded] = await db
      .select({ at: auditLogs.createdAt })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, 'game-tag'),
          eq(auditLogs.entityId, 'demo-seed'),
          eq(auditLogs.actorLabel, 'system:demo-seed'),
        ),
      )
      .orderBy(auditLogs.createdAt)
      .limit(1);
    at = seeded?.at ? seeded.at.getTime() : Number.NaN;
  }
  if (!Number.isFinite(at)) return null;
  const now = Date.now();
  const shift = now - at;
  if (shift < MIN_SHIFT_MS) return null;
  const rows = await db
    .select({ id: gameTags.id, gameId: gameTags.gameId, tagId: gameTags.tagId })
    .from(gameTags)
    .where(eq(gameTags.confirmedByLabel, 'demo-seed'));
  const pending = await db
    .select({ id: gameTags.id, gameId: gameTags.gameId, tagId: gameTags.tagId })
    .from(gameTags)
    .where(and(eq(gameTags.state, 'pending'), eq(gameTags.source, 'players')));
  const candidates = [...rows, ...pending];
  if (candidates.length === 0) return null;
  const touched = new Set(
    (
      await db
        .select({ id: auditLogs.entityId })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, 'game-tag'),
            inArray(
              auditLogs.entityId,
              candidates.map((c) => c.id),
            ),
            sql`${auditLogs.actorLabel} NOT LIKE 'system:%'`,
          ),
        )
    ).map((r) => r.id),
  );
  const voters = (
    await db.select({ id: users.id }).from(users).where(like(users.username, 'gk\\_voter%'))
  ).map((u) => u.id);
  if (voters.length === 0) return null;
  const ms = sql.raw(`interval '${Math.round(shift / 1000)} seconds'`);
  let shifted = 0;
  for (const c of candidates) {
    if (touched.has(c.id)) continue;
    // Only rows whose votes are ALL the seeded voters' — a real reader's vote means
    // the row is no longer pure demo data.
    const [mixed] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(gameTagVotes)
      .where(
        and(
          eq(gameTagVotes.gameId, c.gameId),
          eq(gameTagVotes.tagId, c.tagId),
          notInArray(gameTagVotes.userId, voters),
        ),
      );
    if ((mixed?.n ?? 0) > 0) continue;
    await db
      .update(gameTagVotes)
      .set({ createdAt: sql`${gameTagVotes.createdAt} + ${ms}` })
      .where(and(eq(gameTagVotes.gameId, c.gameId), eq(gameTagVotes.tagId, c.tagId)));
    await db
      .update(gameTags)
      .set({
        firstSeenAt: sql`${gameTags.firstSeenAt} + ${ms}`,
        lastVoteAt: sql`${gameTags.lastVoteAt} + ${ms}`,
        lastConfirmedAt: sql`${gameTags.lastConfirmedAt} + ${ms}`,
        resolvedAt: sql`${gameTags.resolvedAt} + ${ms}`,
      })
      .where(eq(gameTags.id, c.id));
    shifted += 1;
  }
  await db
    .insert(appSettings)
    .values({ key: DEMO_TAGS_ANCHOR_KEY, value: { at: new Date(now).toISOString() } })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: { at: new Date(now).toISOString() }, updatedAt: new Date() },
    });
  if (shifted) {
    await writeAudit({
      action: 'update',
      entityType: 'game-tag',
      entityId: 'demo-realign',
      changes: { shiftedRows: shifted, hours: Math.round(shift / 3_600_000) },
      summary: `demo tag dates realigned to boot (+${Math.round(shift / 3_600_000)}h, ${shifted} rows)`,
      actor: { label: 'system:demo-dates' },
    });
  }
  return { shiftedRows: shifted, hours: Math.round(shift / 3_600_000) };
}
