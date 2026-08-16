import { randomBytes } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import {
  articleTrustVotes,
  badges,
  comments,
  follows,
  gameHypeVotes,
  gameUserRatings,
  games,
  reactions,
  roles,
  sessions,
  subjects,
  topicBiasVotes,
  topics,
  userBadges,
  userConsents,
  userLevels,
  userTokens,
  users,
} from '../db/schema';
import { coarsenIp } from '../auth/session';

/**
 * GDPR operations (SPEC I6, Slice 7, decision 7). TWO rights:
 *
 *  - EXPORT (right to access): the authenticated user's own data as JSON —
 *    profile, ratings, votes, hype, comments, follows, consents.
 *  - DELETE (right to erasure) via ANONYMIZE-AND-TOMBSTONE: a hard delete would
 *    cascade-wipe the ratings/votes we must keep, so instead we KEEP the user
 *    row, scrub every piece of PII, FREE the email/username, and freeze the
 *    credibility fields (isEmailVerified / reputation / createdAt) so the
 *    community aggregates + disconnect math stay HONEST (no dropped votes, no
 *    recomputed-to-zero score). Retained content is detached: comments become
 *    "[deleted]"; ratings/votes/hype/reactions stay, now attributed to an
 *    anonymous tombstone. PII children (sessions, tokens, follows, consents,
 *    badges) are hard-deleted. The audit trail is untouched — its denormalized
 *    actor label preserves the historical record.
 */

export interface DeleteResult {
  freedEmail: string;
  freedUsername: string;
}

/** Anonymize-and-tombstone a user account. Atomic. Returns the freed identifiers. */
export async function deleteAccount(userId: string): Promise<DeleteResult | null> {
  return db.transaction(async (tx) => {
    const [u] = await tx
      .select({ email: users.email, username: users.username })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!u) return null;

    const tag = randomBytes(5).toString('hex');
    // Scrub PII + free the email/username; KEEP the credibility fields so the
    // ratings/votes this user cast keep their honest weight.
    await tx
      .update(users)
      .set({
        username: `deleted_${tag}`,
        email: `deleted-${tag}@deleted.invalid`,
        displayName: null,
        avatarUrl: null,
        bio: null,
        passwordHash: null,
        passwordAlgo: null,
        status: 'deleted',
      })
      .where(eq(users.id, userId));

    // Detach retained content — comments become a tombstone, still counted in threads.
    await tx
      .update(comments)
      .set({ body: '[deleted]', updatedAt: new Date() })
      .where(eq(comments.userId, userId));

    // Hard-delete the PII-bearing children (ratings/votes/hype/reactions are KEPT).
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx.delete(userTokens).where(eq(userTokens.userId, userId));
    await tx.delete(follows).where(eq(follows.userId, userId));
    await tx.delete(userConsents).where(eq(userConsents.userId, userId));
    await tx.delete(userBadges).where(eq(userBadges.userId, userId));

    return { freedEmail: u.email, freedUsername: u.username };
  });
}

/** Record a versioned consent with a COARSENED ip (append-only history). */
export async function recordConsent(
  userId: string,
  consentType: string,
  version: string,
  granted: boolean,
  ip: string | null | undefined,
): Promise<void> {
  await db
    .insert(userConsents)
    .values({ userId, consentType, version, granted, ip: coarsenIp(ip) });
}

// ── export ───────────────────────────────────────────────────────────────────
export interface AccountExport {
  profile: Record<string, unknown>;
  ratings: unknown[];
  trustVotes: unknown[];
  biasVotes: unknown[];
  hype: unknown[];
  reactions: unknown[];
  comments: unknown[];
  follows: unknown[];
  consents: unknown[];
}

/** Assemble the user's full data export (their OWN data — includes their email). */
export async function exportAccount(userId: string): Promise<AccountExport | null> {
  const [profile] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      email: users.email,
      status: users.status,
      reputation: users.reputation,
      isEmailVerified: users.isEmailVerified,
      createdAt: users.createdAt,
      roleKey: roles.key,
      levelKey: userLevels.key,
      levelLabel: userLevels.label,
    })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .leftJoin(userLevels, eq(userLevels.id, users.levelId))
    .where(eq(users.id, userId))
    .limit(1);
  if (!profile) return null;

  const badgeRows = await db
    .select({ key: badges.key, label: badges.label, awardedAt: userBadges.awardedAt })
    .from(userBadges)
    .innerJoin(badges, eq(badges.id, userBadges.badgeId))
    .where(eq(userBadges.userId, userId));

  const ratings = await db
    .select({
      game: subjects.slug,
      gameName: subjects.name,
      score: gameUserRatings.score,
      weight: gameUserRatings.weight,
      ratedAt: gameUserRatings.ratedAt,
    })
    .from(gameUserRatings)
    .innerJoin(games, eq(games.id, gameUserRatings.gameId))
    .innerJoin(subjects, eq(subjects.id, games.subjectId))
    .where(eq(gameUserRatings.userId, userId));

  const trustVotes = await db
    .select({
      articleId: articleTrustVotes.articleId,
      value: articleTrustVotes.value,
      createdAt: articleTrustVotes.createdAt,
    })
    .from(articleTrustVotes)
    .where(eq(articleTrustVotes.userId, userId));

  const biasVotes = await db
    .select({
      topic: topics.slug,
      axis: topicBiasVotes.axis,
      value: topicBiasVotes.value,
      createdAt: topicBiasVotes.createdAt,
    })
    .from(topicBiasVotes)
    .innerJoin(topics, eq(topics.id, topicBiasVotes.topicId))
    .where(eq(topicBiasVotes.userId, userId));

  const hype = await db
    .select({ gameId: gameHypeVotes.gameId, createdAt: gameHypeVotes.createdAt })
    .from(gameHypeVotes)
    .where(eq(gameHypeVotes.userId, userId));

  const reactionRows = await db
    .select({
      entityType: reactions.entityType,
      entityId: reactions.entityId,
      kind: reactions.kind,
      createdAt: reactions.createdAt,
    })
    .from(reactions)
    .where(eq(reactions.userId, userId));

  const commentRows = await db
    .select({
      entityType: comments.entityType,
      entityId: comments.entityId,
      body: comments.body,
      isRemoved: comments.isRemoved,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .where(eq(comments.userId, userId))
    .orderBy(desc(comments.createdAt));

  const followRows = await db
    .select({
      entityType: follows.entityType,
      entityId: follows.entityId,
      createdAt: follows.createdAt,
    })
    .from(follows)
    .where(eq(follows.userId, userId));

  const consents = await db
    .select({
      consentType: userConsents.consentType,
      version: userConsents.version,
      granted: userConsents.granted,
      ip: userConsents.ip,
      createdAt: userConsents.createdAt,
    })
    .from(userConsents)
    .where(eq(userConsents.userId, userId))
    .orderBy(desc(userConsents.createdAt));

  return {
    profile: {
      id: profile.id,
      username: profile.username,
      displayName: profile.displayName,
      email: profile.email,
      status: profile.status,
      reputation: profile.reputation,
      isEmailVerified: profile.isEmailVerified,
      createdAt: profile.createdAt,
      role: profile.roleKey,
      level: profile.levelKey ? { key: profile.levelKey, label: profile.levelLabel } : null,
      badges: badgeRows,
    },
    ratings,
    trustVotes,
    biasVotes,
    hype,
    reactions: reactionRows,
    comments: commentRows,
    follows: followRows,
    consents,
  };
}
