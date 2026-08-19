import { desc, eq, gte, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { db } from '../db/client';
import {
  articleTopics,
  articleTrustVotes,
  articles,
  awardVotes,
  comments,
  gameHypeVotes,
  gameRatingSummaries,
  gameUserRatings,
  games,
  newsletterSubscriptions,
  sources,
  topicBiasVotes,
  topics,
  users,
} from '../db/schema';

/**
 * Control Panel dashboard analytics (SPEC I8, Slice 1; BLUEPRINT 3.14 §1). Every
 * figure is AGGREGATE and ANONYMOUS (golden rule 5 / GDPR): totals, top-N lists,
 * windowed activity COUNTS, and pipeline health — never a per-user row. Read-only,
 * computed on demand from live tables (cheap COUNTs); nothing is cached or tracked.
 * Page-view "traffic" is deliberately NOT collected in the demo (privacy-first) —
 * wire aggregate/edge analytics (e.g. Cloudflare) in production.
 */

const num = (v: unknown): number => Number(v ?? 0);

async function countOf(table: PgTable, where?: SQL): Promise<number> {
  const base = db.select({ c: sql<string>`count(*)` }).from(table);
  const [row] = await (where ? base.where(where) : base);
  return num(row?.c);
}

export interface DashboardData {
  counts: {
    topics: number;
    articles: number;
    games: number;
    sources: number;
    users: number;
    comments: number;
    ratings: number;
    subscribers: number;
  };
  topTopics: { slug: string; title: string; articleCount: number }[];
  topSources: { slug: string; name: string; articleCount: number }[];
  activity: { windowDays: number; ratings: number; comments: number; votes: number; newUsers: number };
  pipeline: {
    articlesTotal: number;
    articlesEmbedded: number;
    topicsTotal: number;
    topicsSummarized: number;
    ratingsComputed: number;
    lastRatingComputedAt: string | null;
  };
  trafficNote: string;
  generatedAt: string;
}

export async function getDashboard(): Promise<DashboardData> {
  const since = new Date(Date.now() - 7 * 86_400_000);

  const [topicCount, articleCount, gameCount, sourceCount, userCount, commentCount, ratingCount, subscriberCount] =
    await Promise.all([
      countOf(topics),
      countOf(articles),
      countOf(games),
      countOf(sources),
      countOf(users),
      countOf(comments),
      countOf(gameUserRatings),
      countOf(newsletterSubscriptions, eq(newsletterSubscriptions.active, true)),
    ]);

  const topTopics = (
    await db
      .select({
        slug: topics.slug,
        title: topics.title,
        articleCount: sql<string>`count(${articleTopics.articleId})`,
      })
      .from(topics)
      .leftJoin(articleTopics, eq(articleTopics.topicId, topics.id))
      .groupBy(topics.id, topics.slug, topics.title)
      .orderBy(desc(sql`count(${articleTopics.articleId})`))
      .limit(6)
  ).map((r) => ({ slug: r.slug, title: r.title, articleCount: num(r.articleCount) }));

  const topSources = (
    await db
      .select({
        slug: sources.slug,
        name: sources.name,
        articleCount: sql<string>`count(${articles.id})`,
      })
      .from(sources)
      .leftJoin(articles, eq(articles.sourceId, sources.id))
      .groupBy(sources.id, sources.slug, sources.name)
      .orderBy(desc(sql`count(${articles.id})`))
      .limit(6)
  ).map((r) => ({ slug: r.slug, name: r.name, articleCount: num(r.articleCount) }));

  const [ratings7d, comments7d, trust7d, bias7d, hype7d, awards7d, newUsers7d] = await Promise.all([
    countOf(gameUserRatings, gte(gameUserRatings.ratedAt, since)),
    countOf(comments, gte(comments.createdAt, since)),
    countOf(articleTrustVotes, gte(articleTrustVotes.createdAt, since)),
    countOf(topicBiasVotes, gte(topicBiasVotes.createdAt, since)),
    countOf(gameHypeVotes, gte(gameHypeVotes.createdAt, since)),
    countOf(awardVotes, gte(awardVotes.createdAt, since)),
    countOf(users, gte(users.createdAt, since)),
  ]);

  const [articlesEmbedded, topicsSummarized, ratingsComputed] = await Promise.all([
    countOf(articles, sql`${articles.embedding} is not null`),
    countOf(topics, sql`${topics.aiSummary} is not null`),
    countOf(gameRatingSummaries, sql`${gameRatingSummaries.computedAt} is not null`),
  ]);
  const [lastRating] = await db
    .select({ at: sql<string | null>`max(${gameRatingSummaries.computedAt})` })
    .from(gameRatingSummaries);

  return {
    counts: {
      topics: topicCount,
      articles: articleCount,
      games: gameCount,
      sources: sourceCount,
      users: userCount,
      comments: commentCount,
      ratings: ratingCount,
      subscribers: subscriberCount,
    },
    topTopics,
    topSources,
    activity: {
      windowDays: 7,
      ratings: ratings7d,
      comments: comments7d,
      votes: trust7d + bias7d + hype7d + awards7d,
      newUsers: newUsers7d,
    },
    pipeline: {
      articlesTotal: articleCount,
      articlesEmbedded,
      topicsTotal: topicCount,
      topicsSummarized,
      ratingsComputed,
      lastRatingComputedAt: lastRating?.at ?? null,
    },
    trafficNote:
      'Page-view traffic is not tracked in the demo (privacy-first; wire aggregate/edge analytics in production).',
    generatedAt: new Date().toISOString(),
  };
}
