import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  articleTrustVotes,
  badges,
  commentReports,
  comments,
  gameHypeVotes,
  gameUserRatings,
  reactions,
  topicBiasVotes,
  userBadges,
  userLevels,
  users,
} from '../db/schema';
import { getRatingSettings } from '../ratings/rating-settings';
import { voterCredibility } from '../community/weighting';
import { reputationSettings, type ReputationSettings } from './settings';

/**
 * Reputation + level + badge engine (SPEC I6, Slice 5, decision 11). All heavy
 * work runs in a background job and is stored — users read a pre-computed level
 * name + progress fraction + badges, and NEVER the formula, the thresholds, the
 * raw reputation number, or that reputation drives their vote weight.
 *
 * The anti-farm core: reputation rises from RECEIVED helpful reactions WEIGHTED
 * BY THE REACTOR'S OWN CREDIBILITY (the same 0→1 curve ratings use). A ring of
 * throwaways has ~0 credibility, so their mutual up-votes add ~0 — the ring
 * plateaus far below the first real level no matter how many accounts it spins
 * up. A single recompute uses a REPUTATION SNAPSHOT for every reactor's
 * credibility, so the pass is order-independent and can't oscillate.
 */
const MS_PER_DAY = 86_400_000;
const SUSPENDED = new Set(['suspended', 'banned']);

export interface ReputationBreakdown {
  helpful: number;
  reports: number;
  tenure: number;
  removedPenalty: number;
  suspended: boolean;
  total: number;
}

export interface RecomputeReputationResult {
  usersProcessed: number;
  badgesAwarded: number;
}

/** The highest level whose reputation floor is satisfied (newcomer = 0). */
export function levelKeyFor(rep: number, t: ReputationSettings['levelThresholds']): string {
  if (rep >= t.legend) return 'legend';
  if (rep >= t.veteran) return 'veteran';
  if (rep >= t.trusted) return 'trusted';
  if (rep >= t.contributor) return 'contributor';
  return 'newcomer';
}

/** Progress (0→1) toward the NEXT level — never leaks the absolute thresholds. */
export function levelProgress(rep: number, t: ReputationSettings['levelThresholds']): number {
  const steps = [0, t.contributor, t.trusted, t.veteran, t.legend];
  for (let i = 0; i < steps.length - 1; i += 1) {
    if (rep < steps[i + 1]!) {
      const span = steps[i + 1]! - steps[i]!;
      return span > 0 ? Math.max(0, Math.min(1, (rep - steps[i]!) / span)) : 1;
    }
  }
  return 1; // legend — maxed
}

/** Recompute EVERY user's reputation, level and auto-badges (idempotent). */
export async function recomputeAllReputation(): Promise<RecomputeReputationResult> {
  const rep = await reputationSettings();
  const credW = (await getRatingSettings()).credibility;

  const allUsers = await db
    .select({
      id: users.id,
      isEmailVerified: users.isEmailVerified,
      reputation: users.reputation,
      status: users.status,
      createdAt: users.createdAt,
    })
    .from(users);

  // Snapshot: each reactor's credibility from their reputation AS IT IS NOW, so
  // the pass is order-independent (a ring can't bootstrap itself within a run).
  const credOf = new Map<string, number>();
  for (const u of allUsers) credOf.set(u.id, voterCredibility(u, credW));

  // Helpful term: Σ reactor-credibility over POSITIVE reactions on each author's
  // non-removed comments. This single JOIN is where the anti-farm lives.
  const helpfulRows = await db
    .select({ author: comments.userId, reactor: reactions.userId })
    .from(reactions)
    .innerJoin(
      comments,
      and(eq(reactions.entityType, 'comment'), eq(reactions.entityId, comments.id)),
    )
    .where(and(eq(comments.isRemoved, false), inArray(reactions.kind, rep.positiveReactions)));
  const helpfulByAuthor = new Map<string, number>();
  for (const r of helpfulRows) {
    helpfulByAuthor.set(
      r.author,
      (helpfulByAuthor.get(r.author) ?? 0) + (credOf.get(r.reactor) ?? 0),
    );
  }

  // Accepted reports: reports the user filed whose target comment ended removed.
  const acceptedRows = await db
    .select({ reporter: commentReports.reporterUserId, n: sql<number>`count(*)::int` })
    .from(commentReports)
    .innerJoin(comments, eq(comments.id, commentReports.commentId))
    .where(eq(comments.isRemoved, true))
    .groupBy(commentReports.reporterUserId);
  const acceptedByUser = new Map(acceptedRows.map((r) => [r.reporter, r.n]));

  // Removed content: the user's OWN comments that were removed (a penalty).
  const removedRows = await db
    .select({ userId: comments.userId, n: sql<number>`count(*)::int` })
    .from(comments)
    .where(eq(comments.isRemoved, true))
    .groupBy(comments.userId);
  const removedByUser = new Map(removedRows.map((r) => [r.userId, r.n]));

  // Level ids by key.
  const levels = await db.select({ id: userLevels.id, key: userLevels.key }).from(userLevels);
  const levelIdOf = new Map(levels.map((l) => [l.key, l.id]));

  const now = Date.now();
  let processed = 0;
  for (const u of allUsers) {
    // A deleted (anonymize-and-tombstone) account is FROZEN — its reputation
    // stays put so the votes it cast keep their honest weight (GDPR, Slice 7).
    // It still counts as a reactor for OTHERS via the credibility snapshot.
    if (u.status === 'deleted') continue;
    const suspended = SUSPENDED.has(u.status);
    const helpful = (helpfulByAuthor.get(u.id) ?? 0) * rep.helpfulWeight;
    const reports = (acceptedByUser.get(u.id) ?? 0) * rep.reportWeight;
    const ageDays = Math.max(0, (now - u.createdAt.getTime()) / MS_PER_DAY);
    const tenure = Math.min(ageDays, rep.tenureCapDays) * rep.tenureWeightPerDay;
    const penalty = (removedByUser.get(u.id) ?? 0) * rep.removedPenalty;
    const total = suspended ? 0 : Math.max(0, Math.round(helpful + reports + tenure - penalty));

    const levelId = levelIdOf.get(levelKeyFor(total, rep.levelThresholds)) ?? null;
    await db
      .update(users)
      .set({ reputation: total, levelPoints: total, levelId })
      .where(eq(users.id, u.id));
    processed += 1;
  }

  const badgesAwarded = await awardAutoBadges(rep);
  return { usersProcessed: processed, badgesAwarded };
}

/**
 * Auto-award the MONOTONIC badges (once earned, kept): `verified` (verified
 * email) and `early-voter` (≥ N community votes cast). Only ADDS — never
 * revokes, so a staff-granted or staff-revoked badge is never clobbered (the
 * editorial badges — top-reviewer / trendsetter / bias-hunter / day-one — are
 * staff-managed via the userBadges CRUD; auto never touches them).
 */
async function awardAutoBadges(rep: ReputationSettings): Promise<number> {
  const badgeRows = await db.select({ id: badges.id, key: badges.key }).from(badges);
  const badgeIdOf = new Map(badgeRows.map((b) => [b.key, b.id]));
  const verifiedBadge = badgeIdOf.get('verified');
  const earlyVoterBadge = badgeIdOf.get('early-voter');

  // votes cast per user across ALL community signals.
  const voteCounts = new Map<string, number>();
  const bump = (userId: string, n: number) =>
    voteCounts.set(userId, (voteCounts.get(userId) ?? 0) + n);
  const [ratingC, trustC, biasC, hypeC] = await Promise.all([
    db
      .select({ userId: gameUserRatings.userId, n: sql<number>`count(*)::int` })
      .from(gameUserRatings)
      .groupBy(gameUserRatings.userId),
    db
      .select({ userId: articleTrustVotes.userId, n: sql<number>`count(*)::int` })
      .from(articleTrustVotes)
      .groupBy(articleTrustVotes.userId),
    db
      .select({ userId: topicBiasVotes.userId, n: sql<number>`count(*)::int` })
      .from(topicBiasVotes)
      .groupBy(topicBiasVotes.userId),
    db
      .select({ userId: gameHypeVotes.userId, n: sql<number>`count(*)::int` })
      .from(gameHypeVotes)
      .groupBy(gameHypeVotes.userId),
  ]);
  for (const r of [...ratingC, ...trustC, ...biasC, ...hypeC]) bump(r.userId, r.n);

  const verifiedUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.isEmailVerified, true));

  // Existing auto-badge grants (skip re-inserting).
  const autoIds = [verifiedBadge, earlyVoterBadge].filter((x): x is string => Boolean(x));
  const existing = new Set<string>();
  if (autoIds.length > 0) {
    const rows = await db
      .select({ userId: userBadges.userId, badgeId: userBadges.badgeId })
      .from(userBadges)
      .where(inArray(userBadges.badgeId, autoIds));
    for (const r of rows) existing.add(`${r.userId}:${r.badgeId}`);
  }

  let awarded = 0;
  const grant = async (userId: string, badgeId: string | undefined) => {
    if (!badgeId || existing.has(`${userId}:${badgeId}`)) return;
    await db.insert(userBadges).values({ userId, badgeId }).onConflictDoNothing();
    existing.add(`${userId}:${badgeId}`);
    awarded += 1;
  };
  for (const u of verifiedUsers) await grant(u.id, verifiedBadge);
  for (const [userId, n] of voteCounts) {
    if (n >= rep.earlyVoterVotes) await grant(userId, earlyVoterBadge);
  }
  return awarded;
}

// ── reads ────────────────────────────────────────────────────────────────────
export interface ProfileView {
  level: { key: string; label: string; progress: number } | null;
  badges: { key: string; label: string; iconUrl: string | null }[];
}

/**
 * The PUBLIC-safe profile: level name + progress fraction + badges. Deliberately
 * carries NO reputation number and NO thresholds (decision 11). Used by
 * /auth/me and, in Slice 8, public profiles.
 */
export async function getProfileView(userId: string): Promise<ProfileView> {
  const rep = await reputationSettings();
  const [u] = await db
    .select({
      reputation: users.reputation,
      levelKey: userLevels.key,
      levelLabel: userLevels.label,
    })
    .from(users)
    .leftJoin(userLevels, eq(userLevels.id, users.levelId))
    .where(eq(users.id, userId))
    .limit(1);

  const badgeRows = await db
    .select({ key: badges.key, label: badges.label, iconUrl: badges.iconUrl })
    .from(userBadges)
    .innerJoin(badges, eq(badges.id, userBadges.badgeId))
    .where(eq(userBadges.userId, userId));

  const level = u?.levelKey
    ? {
        key: u.levelKey,
        label: u.levelLabel ?? u.levelKey,
        progress: Math.round(levelProgress(u.reputation ?? 0, rep.levelThresholds) * 100) / 100,
      }
    : null;
  return { level, badges: badgeRows };
}

/** Staff-only reputation breakdown (transparency for moderators; NEVER public). */
export async function getReputationBreakdown(userId: string): Promise<ReputationBreakdown | null> {
  const rep = await reputationSettings();
  const credW = (await getRatingSettings()).credibility;
  const [u] = await db
    .select({
      id: users.id,
      isEmailVerified: users.isEmailVerified,
      reputation: users.reputation,
      status: users.status,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) return null;

  const helpfulRows = await db
    .select({
      reactor: reactions.userId,
      reputation: users.reputation,
      isEmailVerified: users.isEmailVerified,
      createdAt: users.createdAt,
    })
    .from(reactions)
    .innerJoin(
      comments,
      and(eq(reactions.entityType, 'comment'), eq(reactions.entityId, comments.id)),
    )
    .innerJoin(users, eq(users.id, reactions.userId))
    .where(
      and(
        eq(comments.userId, userId),
        eq(comments.isRemoved, false),
        inArray(reactions.kind, rep.positiveReactions),
      ),
    );
  const helpful =
    helpfulRows.reduce((s, r) => s + voterCredibility(r, credW), 0) * rep.helpfulWeight;

  const [acc] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(commentReports)
    .innerJoin(comments, eq(comments.id, commentReports.commentId))
    .where(and(eq(commentReports.reporterUserId, userId), eq(comments.isRemoved, true)));
  const reports = (acc?.n ?? 0) * rep.reportWeight;

  const [rem] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(comments)
    .where(and(eq(comments.userId, userId), eq(comments.isRemoved, true)));
  const removedPenalty = (rem?.n ?? 0) * rep.removedPenalty;

  const ageDays = Math.max(0, (Date.now() - u.createdAt.getTime()) / MS_PER_DAY);
  const tenure = Math.min(ageDays, rep.tenureCapDays) * rep.tenureWeightPerDay;
  const suspended = SUSPENDED.has(u.status);
  const total = suspended
    ? 0
    : Math.max(0, Math.round(helpful + reports + tenure - removedPenalty));
  return {
    helpful: Math.round(helpful * 100) / 100,
    reports,
    tenure: Math.round(tenure * 100) / 100,
    removedPenalty,
    suspended,
    total,
  };
}
