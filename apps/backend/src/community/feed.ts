import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import {
  articleSubjects,
  articleTopics,
  articles,
  follows,
  games,
  sources,
  subjects,
  topics,
} from '../db/schema';

/**
 * Follows + "Your Feed" (SPEC I6, Slice 6, decision 9). A user follows GAMES or
 * TOPICS; the feed is the recent coverage linked to those entities. Following is
 * open to UNVERIFIED users (decision 6) — the route gates on requireAuth, not
 * requireVerified. Notification delivery is deferred to I8. Everything here is
 * PER-USER, so callers must serve it with a no-store / short private cache —
 * never the anonymous edge cache the public pages use.
 */

/** Resolve a public SLUG to the entity's id (games live under `subjects.slug`). */
export async function resolveFollowTarget(
  entityType: string,
  slug: string,
): Promise<string | null> {
  if (entityType === 'game') {
    const [row] = await db
      .select({ id: games.id })
      .from(games)
      .innerJoin(subjects, eq(subjects.id, games.subjectId))
      .where(eq(subjects.slug, slug))
      .limit(1);
    return row?.id ?? null;
  }
  if (entityType === 'topic') {
    const [row] = await db
      .select({ id: topics.id })
      .from(topics)
      .where(eq(topics.slug, slug))
      .limit(1);
    return row?.id ?? null;
  }
  return null;
}

export async function followEntity(
  userId: string,
  entityType: string,
  entityId: string,
): Promise<{ following: boolean }> {
  await db.insert(follows).values({ userId, entityType, entityId }).onConflictDoNothing();
  return { following: true };
}

export async function unfollowEntity(
  userId: string,
  entityType: string,
  entityId: string,
): Promise<{ following: boolean }> {
  await db
    .delete(follows)
    .where(
      and(
        eq(follows.userId, userId),
        eq(follows.entityType, entityType),
        eq(follows.entityId, entityId),
      ),
    );
  return { following: false };
}

export async function isFollowing(
  userId: string,
  entityType: string,
  entityId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: follows.id })
    .from(follows)
    .where(
      and(
        eq(follows.userId, userId),
        eq(follows.entityType, entityType),
        eq(follows.entityId, entityId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export interface FeedGame {
  slug: string;
  name: string;
  coverUrl: string | null;
}
export interface FeedTopic {
  slug: string;
  title: string;
  lastActivityAt: string | null;
}
export interface FeedItem {
  id: string;
  title: string;
  url: string | null;
  excerpt: string | null;
  origin: string;
  publishDate: string | null;
  sourceName: string | null;
  sourceSlug: string | null;
  /** Which followed entity surfaced this item into the feed. */
  via: { type: 'game' | 'topic'; name: string; slug: string };
}
export interface FeedData {
  followedGames: FeedGame[];
  followedTopics: FeedTopic[];
  items: FeedItem[];
  isEmpty: boolean; // the user follows nothing yet
}

const FEED_LIMIT = 30;

/**
 * Compose a user's follow-based feed: the games/topics they follow plus the
 * recent articles linked to those entities, merged newest-first. Leak-proof —
 * only public article fields (never the internal bias/quality scoring).
 */
export async function getFeed(userId: string): Promise<FeedData> {
  const followRows = await db
    .select({ entityType: follows.entityType, entityId: follows.entityId })
    .from(follows)
    .where(eq(follows.userId, userId));

  const gameIds = followRows.filter((r) => r.entityType === 'game').map((r) => r.entityId);
  const topicIds = followRows.filter((r) => r.entityType === 'topic').map((r) => r.entityId);
  if (gameIds.length === 0 && topicIds.length === 0) {
    return { followedGames: [], followedTopics: [], items: [], isEmpty: true };
  }

  const followedGames: FeedGame[] = gameIds.length
    ? await db
        .select({ slug: subjects.slug, name: subjects.name, coverUrl: games.coverUrl })
        .from(games)
        .innerJoin(subjects, eq(subjects.id, games.subjectId))
        .where(inArray(games.id, gameIds))
    : [];

  const topicRows = topicIds.length
    ? await db
        .select({ slug: topics.slug, title: topics.title, lastActivityAt: topics.lastActivityAt })
        .from(topics)
        .where(inArray(topics.id, topicIds))
    : [];
  const followedTopics: FeedTopic[] = topicRows.map((t) => ({
    slug: t.slug,
    title: t.title,
    lastActivityAt: t.lastActivityAt ? t.lastActivityAt.toISOString() : null,
  }));

  // Recent articles linked to followed GAMES (article → subject → game).
  const gameArticles = gameIds.length
    ? await db
        .select({
          id: articles.id,
          title: articles.title,
          url: articles.url,
          excerpt: articles.excerpt,
          origin: articles.origin,
          publishDate: articles.publishDate,
          sourceName: sources.name,
          sourceSlug: sources.slug,
          viaName: subjects.name,
          viaSlug: subjects.slug,
        })
        .from(articles)
        .innerJoin(articleSubjects, eq(articleSubjects.articleId, articles.id))
        .innerJoin(subjects, eq(subjects.id, articleSubjects.subjectId))
        .innerJoin(games, eq(games.subjectId, subjects.id))
        .leftJoin(sources, eq(sources.id, articles.sourceId))
        .where(inArray(games.id, gameIds))
        .orderBy(desc(articles.publishDate))
        .limit(FEED_LIMIT)
    : [];

  // Recent articles linked to followed TOPICS (article → topic).
  const topicArticles = topicIds.length
    ? await db
        .select({
          id: articles.id,
          title: articles.title,
          url: articles.url,
          excerpt: articles.excerpt,
          origin: articles.origin,
          publishDate: articles.publishDate,
          sourceName: sources.name,
          sourceSlug: sources.slug,
          viaName: topics.title,
          viaSlug: topics.slug,
        })
        .from(articles)
        .innerJoin(articleTopics, eq(articleTopics.articleId, articles.id))
        .innerJoin(topics, eq(topics.id, articleTopics.topicId))
        .leftJoin(sources, eq(sources.id, articles.sourceId))
        .where(inArray(topics.id, topicIds))
        .orderBy(desc(articles.publishDate))
        .limit(FEED_LIMIT)
    : [];

  // Merge + dedupe by article id (a game item wins if an article is in both),
  // newest first, capped. `via` records which follow surfaced it.
  const byId = new Map<string, FeedItem>();
  const push = (rows: typeof gameArticles, type: 'game' | 'topic') => {
    for (const r of rows) {
      if (byId.has(r.id)) continue;
      byId.set(r.id, {
        id: r.id,
        title: r.title,
        url: r.url,
        excerpt: r.excerpt,
        origin: r.origin,
        publishDate: r.publishDate ? r.publishDate.toISOString() : null,
        sourceName: r.sourceName,
        sourceSlug: r.sourceSlug,
        via: { type, name: r.viaName, slug: r.viaSlug },
      });
    }
  };
  push(gameArticles, 'game');
  push(topicArticles, 'topic');

  const items = [...byId.values()]
    .sort((a, b) => (b.publishDate ?? '').localeCompare(a.publishDate ?? ''))
    .slice(0, FEED_LIMIT);

  return { followedGames, followedTopics, items, isEmpty: false };
}
