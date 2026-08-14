import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  articleTrustVotes,
  articles,
  commentReports,
  comments,
  gameHypeVotes,
  gameRatingSummaries,
  gameUserRatings,
  games,
  reactions,
  topicBiasVotes,
  topics,
  users,
} from '../db/schema';
import { writeAudit, type AuditActor } from '../admin/audit';
import { enqueueRatingRecompute } from '../ratings/jobs';
import { getRatingSettings } from '../ratings/rating-settings';
import { communitySettings } from './settings';
import { voterCredibility, weightedAggregate, type WeightedVote } from './weighting';

/**
 * Community write/read service (SPEC I6, Slice 4). Every WRITE here is reached
 * only after the route has enforced: a VERIFIED-email session (decision 6), the
 * CSRF double-submit, and the per-user rate limit. One-per-user integrity is a
 * DB unique index (upsert / toggle), never a read-then-write race. Game ratings
 * feed the I4b burst-aware engine (background recompute); the other signals are
 * credibility-weighted on read (decision 13).
 */

/** The session fields a write needs (both the gate and the weighting). */
export interface Actor {
  id: string;
  isEmailVerified: boolean;
  reputation: number;
  createdAt: Date;
}

/** A polymorphic comment/reaction target must actually exist (anti-bug rule). */
export async function entityExists(entityType: string, entityId: string): Promise<boolean> {
  const table =
    entityType === 'game'
      ? games
      : entityType === 'article'
        ? articles
        : entityType === 'topic'
          ? topics
          : null;
  if (!table) return false;
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(eq(table.id, entityId))
    .limit(1);
  return Boolean(row);
}

// ── game ratings (feed the I4b engine) ───────────────────────────────────────
/** Upsert the user's rating for a game (one per user) and enqueue a recompute. */
export async function rateGame(user: Actor, gameId: string, score: number): Promise<void> {
  await db
    .insert(gameUserRatings)
    .values({ gameId, userId: user.id, score, ratedAt: new Date() })
    .onConflictDoUpdate({
      target: [gameUserRatings.gameId, gameUserRatings.userId],
      set: { score, ratedAt: new Date(), updatedAt: new Date() },
    });
  // Heavy work (weighting + burst detection) runs off the request path.
  await enqueueRatingRecompute({ gameId, reason: 'community-rating' });
}

/** Remove the user's rating and enqueue a recompute. */
export async function unrateGame(user: Actor, gameId: string): Promise<void> {
  await db
    .delete(gameUserRatings)
    .where(and(eq(gameUserRatings.gameId, gameId), eq(gameUserRatings.userId, user.id)));
  await enqueueRatingRecompute({ gameId, reason: 'community-rating-removed' });
}

// ── article trust votes ──────────────────────────────────────────────────────
export async function trustVoteArticle(
  user: Actor,
  articleId: string,
  value: 1 | -1,
): Promise<void> {
  await db
    .insert(articleTrustVotes)
    .values({ articleId, userId: user.id, value })
    .onConflictDoUpdate({
      target: [articleTrustVotes.articleId, articleTrustVotes.userId],
      set: { value, createdAt: new Date() },
    });
}

// ── topic bias votes (per axis; value 0 clears the stance) ───────────────────
export async function biasVoteTopic(
  user: Actor,
  topicId: string,
  axis: string,
  value: -1 | 0 | 1,
): Promise<void> {
  if (value === 0) {
    await db
      .delete(topicBiasVotes)
      .where(
        and(
          eq(topicBiasVotes.topicId, topicId),
          eq(topicBiasVotes.userId, user.id),
          eq(topicBiasVotes.axis, axis),
        ),
      );
    return;
  }
  await db
    .insert(topicBiasVotes)
    .values({ topicId, userId: user.id, axis, value })
    .onConflictDoUpdate({
      target: [topicBiasVotes.topicId, topicBiasVotes.userId, topicBiasVotes.axis],
      set: { value, createdAt: new Date() },
    });
}

// ── upcoming hype (one-per-user toggle) ──────────────────────────────────────
export async function toggleHype(user: Actor, gameId: string): Promise<{ hyped: boolean }> {
  const removed = await db
    .delete(gameHypeVotes)
    .where(and(eq(gameHypeVotes.gameId, gameId), eq(gameHypeVotes.userId, user.id)))
    .returning({ id: gameHypeVotes.id });
  if (removed.length > 0) return { hyped: false };
  await db.insert(gameHypeVotes).values({ gameId, userId: user.id }).onConflictDoNothing();
  return { hyped: true };
}

// ── reactions (one-per-user-per-kind toggle) ─────────────────────────────────
export async function toggleReaction(
  user: Actor,
  entityType: string,
  entityId: string,
  kind: string,
): Promise<{ reacted: boolean }> {
  const removed = await db
    .delete(reactions)
    .where(
      and(
        eq(reactions.entityType, entityType),
        eq(reactions.entityId, entityId),
        eq(reactions.userId, user.id),
        eq(reactions.kind, kind),
      ),
    )
    .returning({ id: reactions.id });
  if (removed.length > 0) return { reacted: false };
  await db
    .insert(reactions)
    .values({ entityType, entityId, userId: user.id, kind })
    .onConflictDoNothing();
  return { reacted: true };
}

// ── comments (store RAW; escaped at render — decision 8) ─────────────────────
export async function addComment(
  user: Actor,
  entityType: string,
  entityId: string,
  body: string,
  parentId: string | undefined,
): Promise<{ id: string }> {
  const [row] = await db
    .insert(comments)
    .values({ entityType, entityId, userId: user.id, body, parentId: parentId ?? null })
    .returning({ id: comments.id });
  return { id: row!.id };
}

export interface PublicComment {
  id: string;
  parentId: string | null;
  body: string;
  username: string;
  createdAt: Date;
}

/** List a target's visible (non-removed) comments, newest first, with author. */
export async function listComments(entityType: string, entityId: string): Promise<PublicComment[]> {
  const rows = await db
    .select({
      id: comments.id,
      parentId: comments.parentId,
      body: comments.body,
      username: users.username,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.userId))
    .where(
      and(
        eq(comments.entityType, entityType),
        eq(comments.entityId, entityId),
        eq(comments.isRemoved, false),
      ),
    )
    .orderBy(sql`${comments.createdAt} desc`)
    .limit(200);
  return rows;
}

// ── comment reports + auto-hide ──────────────────────────────────────────────
export interface ReportResult {
  reported: boolean; // false = the user had already reported this comment
  autoHidden: boolean; // the report crossed the threshold and hid the comment
}

/** Report a comment (one per user); auto-hide when distinct reports cross N. */
export async function reportComment(
  user: Actor,
  commentId: string,
  reason: string | undefined,
): Promise<ReportResult | null> {
  const [target] = await db
    .select({ id: comments.id, isRemoved: comments.isRemoved })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  if (!target) return null; // unknown comment

  const inserted = await db
    .insert(commentReports)
    .values({ commentId, reporterUserId: user.id, reason: reason ?? null })
    .onConflictDoNothing()
    .returning({ id: commentReports.id });
  const reported = inserted.length > 0;

  let autoHidden = false;
  if (reported && !target.isRemoved) {
    const [countRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(commentReports)
      .where(eq(commentReports.commentId, commentId));
    const n = countRow?.n ?? 0;
    const { autoHideReports } = await communitySettings();
    if (n >= autoHideReports) {
      const hidden = await db
        .update(comments)
        .set({ isRemoved: true, updatedAt: new Date() })
        .where(and(eq(comments.id, commentId), eq(comments.isRemoved, false)))
        .returning({ id: comments.id });
      if (hidden.length > 0) {
        autoHidden = true;
        await writeAudit({
          action: 'update',
          entityType: 'comments',
          entityId: commentId,
          changes: { isRemoved: { from: false, to: true }, reason: 'auto-hide', reportCount: n },
          summary: `comment auto-hidden at ${n} reports`,
          actor: { label: 'system:auto-hide' },
        });
      }
    }
  }
  return { reported, autoHidden };
}

/** Moderator soft-remove / restore of a comment (audited). */
export async function moderateComment(
  commentId: string,
  isRemoved: boolean,
  actor: AuditActor,
): Promise<boolean> {
  const [before] = await db
    .select({ isRemoved: comments.isRemoved })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  if (!before) return false;
  await db
    .update(comments)
    .set({ isRemoved, updatedAt: new Date() })
    .where(eq(comments.id, commentId));
  await writeAudit({
    action: 'update',
    entityType: 'comments',
    entityId: commentId,
    changes: { isRemoved: { from: before.isRemoved, to: isRemoved } },
    summary: isRemoved ? 'comment removed by moderator' : 'comment restored by moderator',
    actor,
  });
  return true;
}

// ── credibility-weighted aggregate reads (decision 13) ───────────────────────
async function credibilityWeights(): Promise<Parameters<typeof voterCredibility>[1]> {
  return (await getRatingSettings()).credibility;
}

export interface RatingAggregate {
  weighted: number | null; // credibility-weighted community score (pre-computed)
  naive: number | null; // unweighted mean (transparency)
  count: number;
  burstFlag: boolean;
  myScore: number | null;
}

/**
 * The pre-computed community rating for a game (the I4b engine stores it) plus
 * the caller's own score. Read-only — never recomputes on the request path.
 */
export async function gameRatingAggregate(
  gameId: string,
  userId: string,
): Promise<RatingAggregate> {
  const [summary] = await db
    .select({
      weighted: gameRatingSummaries.communityOurScore,
      naive: gameRatingSummaries.communityOurNaiveScore,
      count: gameRatingSummaries.communityOurCount,
      burstFlag: gameRatingSummaries.communityBurstFlag,
    })
    .from(gameRatingSummaries)
    .where(eq(gameRatingSummaries.gameId, gameId))
    .limit(1);
  const [mine] = await db
    .select({ score: gameUserRatings.score })
    .from(gameUserRatings)
    .where(and(eq(gameUserRatings.gameId, gameId), eq(gameUserRatings.userId, userId)))
    .limit(1);
  return {
    weighted: summary?.weighted ?? null,
    naive: summary?.naive ?? null,
    count: summary?.count ?? 0,
    burstFlag: summary?.burstFlag ?? false,
    myScore: mine?.score ?? null,
  };
}

export interface TrustAggregate {
  weightedMean: number | null; // −1..+1 (credibility-weighted)
  naiveMean: number | null;
  count: number;
  myVote: number | null;
}

/** Article trust vote aggregate, credibility-weighted, plus the caller's vote. */
export async function articleTrustAggregate(
  articleId: string,
  userId: string,
): Promise<TrustAggregate> {
  const w = await credibilityWeights();
  const rows = await db
    .select({
      value: articleTrustVotes.value,
      userId: articleTrustVotes.userId,
      isEmailVerified: users.isEmailVerified,
      reputation: users.reputation,
      createdAt: users.createdAt,
    })
    .from(articleTrustVotes)
    .innerJoin(users, eq(users.id, articleTrustVotes.userId))
    .where(eq(articleTrustVotes.articleId, articleId));
  const votes: WeightedVote[] = rows.map((r) => ({
    value: r.value,
    credibility: voterCredibility(r, w),
  }));
  const agg = weightedAggregate(votes);
  const mine = rows.find((r) => r.userId === userId);
  return {
    weightedMean: agg.weightedMean,
    naiveMean: agg.naiveMean,
    count: agg.count,
    myVote: mine ? mine.value : null,
  };
}

export interface BiasAxisAggregate {
  weightedMean: number | null;
  naiveMean: number | null;
  count: number;
  myVote: number | null;
}

/** Topic bias aggregate PER AXIS, credibility-weighted, plus the caller's votes. */
export async function topicBiasAggregate(
  topicId: string,
  userId: string,
): Promise<Record<string, BiasAxisAggregate>> {
  const w = await credibilityWeights();
  const rows = await db
    .select({
      axis: topicBiasVotes.axis,
      value: topicBiasVotes.value,
      userId: topicBiasVotes.userId,
      isEmailVerified: users.isEmailVerified,
      reputation: users.reputation,
      createdAt: users.createdAt,
    })
    .from(topicBiasVotes)
    .innerJoin(users, eq(users.id, topicBiasVotes.userId))
    .where(eq(topicBiasVotes.topicId, topicId));

  const byAxis: Record<string, { votes: WeightedVote[]; myVote: number | null }> = {};
  for (const r of rows) {
    const bucket = (byAxis[r.axis] ??= { votes: [], myVote: null });
    bucket.votes.push({ value: r.value, credibility: voterCredibility(r, w) });
    if (r.userId === userId) bucket.myVote = r.value;
  }
  const out: Record<string, BiasAxisAggregate> = {};
  for (const [axis, b] of Object.entries(byAxis)) {
    const agg = weightedAggregate(b.votes);
    out[axis] = {
      weightedMean: agg.weightedMean,
      naiveMean: agg.naiveMean,
      count: agg.count,
      myVote: b.myVote,
    };
  }
  return out;
}

export interface HypeAggregate {
  count: number; // raw hype count
  weighted: number; // credibility-weighted hype mass
  mine: boolean;
}

/** Upcoming-game hype aggregate, credibility-weighted, plus whether I hyped. */
export async function gameHypeAggregate(gameId: string, userId: string): Promise<HypeAggregate> {
  const w = await credibilityWeights();
  const rows = await db
    .select({
      userId: gameHypeVotes.userId,
      isEmailVerified: users.isEmailVerified,
      reputation: users.reputation,
      createdAt: users.createdAt,
    })
    .from(gameHypeVotes)
    .innerJoin(users, eq(users.id, gameHypeVotes.userId))
    .where(eq(gameHypeVotes.gameId, gameId));
  const votes: WeightedVote[] = rows.map((r) => ({
    value: 1,
    credibility: voterCredibility(r, w),
  }));
  const agg = weightedAggregate(votes);
  return {
    count: agg.count,
    weighted: agg.weightSum,
    mine: rows.some((r) => r.userId === userId),
  };
}
