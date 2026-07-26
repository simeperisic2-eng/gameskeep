import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { articles, articleTopics, sources, topics } from '../db/schema';
import { describeArticleSource } from '../data-source/articles';
import { getClusterSettings, type ClusterSettings } from './settings';

/**
 * Read-side clustering queries (SPEC I3 verify surfaces). Shared by the admin
 * routes and the verify script so "what got clustered" has one definition.
 */

function dbRows<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows ?? (res as T[])) as T[];
}

async function scalar(query: ReturnType<typeof sql>): Promise<number> {
  const res = await db.execute(query);
  const [row] = dbRows<{ n: number | string }>(res);
  return row ? Number(row.n) : 0;
}

export interface ClusteringStats {
  provider: ReturnType<typeof describeArticleSource>;
  settings: ClusterSettings;
  totalArticles: number;
  aggregatedArticles: number;
  /** Articles that came from the feed (have a source guid) — what I3 produces. */
  feedArticles: number;
  articlesWithEmbedding: number;
  articlesWithPrimaryTopic: number;
  totalTopics: number;
  topicsWithSummary: number;
  multiSourceTopics: number;
  articlesWithGame: number;
}

export async function getClusteringStats(): Promise<ClusteringStats> {
  const [settings, totalArticles, aggregatedArticles, feedArticles] = await Promise.all([
    getClusterSettings(),
    scalar(sql`SELECT count(*)::int AS n FROM articles`),
    scalar(sql`SELECT count(*)::int AS n FROM articles WHERE origin = 'aggregated'`),
    scalar(sql`SELECT count(*)::int AS n FROM articles WHERE external_guid IS NOT NULL`),
  ]);
  const [articlesWithEmbedding, articlesWithPrimaryTopic, totalTopics, topicsWithSummary] =
    await Promise.all([
      scalar(sql`SELECT count(*)::int AS n FROM articles WHERE embedding IS NOT NULL`),
      scalar(
        sql`SELECT count(DISTINCT article_id)::int AS n FROM article_topics WHERE is_primary = true`,
      ),
      scalar(sql`SELECT count(*)::int AS n FROM topics`),
      scalar(sql`SELECT count(*)::int AS n FROM topics WHERE ai_summary IS NOT NULL`),
    ]);
  const multiSourceTopics = await scalar(sql`
    SELECT count(*)::int AS n FROM (
      SELECT at.topic_id
      FROM article_topics at
      JOIN articles a ON a.id = at.article_id
      WHERE a.source_id IS NOT NULL
      GROUP BY at.topic_id
      HAVING count(DISTINCT a.source_id) > 1
    ) x
  `);
  const articlesWithGame = await scalar(
    sql`SELECT count(DISTINCT article_id)::int AS n FROM article_subjects`,
  );

  return {
    provider: describeArticleSource(),
    settings,
    totalArticles,
    aggregatedArticles,
    feedArticles,
    articlesWithEmbedding,
    articlesWithPrimaryTopic,
    totalTopics,
    topicsWithSummary,
    multiSourceTopics,
    articlesWithGame,
  };
}

export interface TopicArticleView {
  id: string;
  guid: string | null;
  slug: string;
  title: string;
  sourceSlug: string | null;
  isPrimary: boolean;
  hasEmbedding: boolean;
}

export interface TopicView {
  id: string;
  slug: string;
  title: string;
  tldr: string | null;
  aiSummary: string | null;
  status: string;
  lastActivityAt: string | null;
  articleCount: number;
  sources: string[];
  articles: TopicArticleView[];
}

/**
 * Topics with their articles + the set of sources covering them — the core
 * "did clustering work" view (multi-source = one event seen by many outlets).
 */
export async function listTopicsWithSources(limit = 500): Promise<TopicView[]> {
  const topicRows = await db
    .select({
      id: topics.id,
      slug: topics.slug,
      title: topics.title,
      tldr: topics.tldr,
      aiSummary: topics.aiSummary,
      status: topics.status,
      lastActivityAt: topics.lastActivityAt,
      embedding: topics.embedding,
    })
    .from(topics)
    .limit(limit);

  const linkRows = await db
    .select({
      topicId: articleTopics.topicId,
      isPrimary: articleTopics.isPrimary,
      articleId: articles.id,
      guid: articles.externalGuid,
      slug: articles.slug,
      title: articles.title,
      sourceSlug: sources.slug,
      embedding: articles.embedding,
    })
    .from(articleTopics)
    .innerJoin(articles, eq(articleTopics.articleId, articles.id))
    .leftJoin(sources, eq(articles.sourceId, sources.id));

  const byTopic = new Map<string, TopicArticleView[]>();
  for (const r of linkRows) {
    const list = byTopic.get(r.topicId) ?? [];
    list.push({
      id: r.articleId,
      guid: r.guid,
      slug: r.slug,
      title: r.title,
      sourceSlug: r.sourceSlug,
      isPrimary: r.isPrimary,
      hasEmbedding: Array.isArray(r.embedding) && r.embedding.length > 0,
    });
    byTopic.set(r.topicId, list);
  }

  return topicRows
    .map((t) => {
      const articleList = byTopic.get(t.id) ?? [];
      const sourceSet = new Set<string>();
      for (const a of articleList) if (a.sourceSlug) sourceSet.add(a.sourceSlug);
      return {
        id: t.id,
        slug: t.slug,
        title: t.title,
        tldr: t.tldr,
        aiSummary: t.aiSummary,
        status: t.status,
        lastActivityAt: t.lastActivityAt ? t.lastActivityAt.toISOString() : null,
        articleCount: articleList.length,
        sources: [...sourceSet].sort(),
        articles: articleList,
      };
    })
    .sort((a, b) => b.articleCount - a.articleCount);
}
