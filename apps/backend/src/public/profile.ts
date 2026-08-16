import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { badges, comments, gameUserRatings, roles, userBadges, users } from '../db/schema';
import { levelViewFor } from '../reputation/engine';

/**
 * The PUBLIC profile (SPEC I6, Slice 8) — leak-proof by construction: username,
 * display name, role/level NAMES, badges, join date, and public activity
 * COUNTS. NEVER the email, the raw reputation number, thresholds, or vote
 * weight (decision 11). Deleted/tombstone and non-active accounts 404.
 */
export interface PublicProfile {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: string;
  level: { key: string; label: string } | null;
  badges: { key: string; label: string; iconUrl: string | null }[];
  joinedAt: string;
  ratingCount: number;
  commentCount: number;
}

export async function getPublicProfile(username: string): Promise<PublicProfile | null> {
  const [u] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      status: users.status,
      reputation: users.reputation,
      createdAt: users.createdAt,
      roleKey: roles.key,
    })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(sql`lower(${users.username}) = ${username.toLowerCase()}`)
    .limit(1);
  if (!u || u.status !== 'active') return null; // tombstones + suspended/banned are hidden

  const level = await levelViewFor(u.reputation); // computed live → always present

  const badgeRows = await db
    .select({ key: badges.key, label: badges.label, iconUrl: badges.iconUrl })
    .from(userBadges)
    .innerJoin(badges, eq(badges.id, userBadges.badgeId))
    .where(eq(userBadges.userId, u.id));

  const [ratingRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(gameUserRatings)
    .where(eq(gameUserRatings.userId, u.id));
  const [commentRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(comments)
    .where(and(eq(comments.userId, u.id), eq(comments.isRemoved, false)));
  const ratingCount = ratingRow?.n ?? 0;
  const commentCount = commentRow?.n ?? 0;

  return {
    username: u.username,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    role: u.roleKey,
    level: { key: level.key, label: level.label },
    badges: badgeRows,
    joinedAt: u.createdAt.toISOString(),
    ratingCount: ratingCount ?? 0,
    commentCount: commentCount ?? 0,
  };
}
