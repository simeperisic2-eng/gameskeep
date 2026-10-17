import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  articles,
  articleSubjects,
  criticFeedDecisions,
  gameCriticReviews,
  games,
  sources,
  subjects,
} from '../db/schema';
import { writeAudit, type AuditActor } from '../admin/audit';
import { enqueueRatingRecompute } from '../ratings/jobs';
import { rulesSettings } from '../rules/settings';
import { detectScore, type ScoreSuggestion } from './score-patterns';

/**
 * The critic-layer feed (Phase P S5 — "Score this review"). Ingested outlet
 * REVIEWS that carry a game and have no critic score yet, newest first, each
 * prefilled with outlet, link and date — and, when the title or excerpt carries
 * a score pattern, a SUGGESTED score the editor confirms. Nothing auto-publishes:
 * a confirmed score becomes a critic review (linked to the article by its feed
 * guid, so it is scored once), audited, and the ratings recompute in the
 * background. "Not a scored review" dismisses an item (also by guid — it
 * survives a full re-cluster).
 */
export class CriticFeedError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface CriticFeedItem {
  guid: string;
  title: string;
  excerpt: string | null;
  url: string | null;
  reviewDate: string | null;
  outlet: { name: string; slug: string | null };
  game: { slug: string; name: string };
  suggestion: ScoreSuggestion | null;
}

const isReview = sql`(${articles.articleType} = 'review' OR coalesce(${articles.categoryOverride}, ${articles.category}) = 'review')`;

async function candidates(guid?: string) {
  const rules = (await rulesSettings()).criticFeed;
  return db
    .selectDistinctOn([articles.externalGuid], {
      guid: articles.externalGuid,
      title: articles.title,
      excerpt: articles.excerpt,
      url: articles.url,
      publishDate: articles.publishDate,
      sourceId: articles.sourceId,
      sourceName: sources.name,
      sourceSlug: sources.slug,
      gameId: games.id,
      gameSlug: subjects.slug,
      gameName: subjects.name,
    })
    .from(articles)
    .innerJoin(articleSubjects, eq(articleSubjects.articleId, articles.id))
    .innerJoin(subjects, eq(subjects.id, articleSubjects.subjectId))
    .innerJoin(games, eq(games.subjectId, subjects.id))
    .leftJoin(sources, eq(sources.id, articles.sourceId))
    .where(
      and(
        isReview,
        eq(articles.origin, 'aggregated'),
        sql`${articles.externalGuid} IS NOT NULL`,
        guid
          ? eq(articles.externalGuid, guid)
          : sql`${articles.publishDate} > now() - (${rules.lookbackDays}::int * interval '1 day')`,
        sql`NOT EXISTS (SELECT 1 FROM game_critic_reviews c WHERE c.source_article_guid = ${articles.externalGuid})`,
        sql`NOT EXISTS (SELECT 1 FROM critic_feed_decisions d WHERE d.article_guid = ${articles.externalGuid})`,
      ),
    )
    .orderBy(articles.externalGuid, desc(articles.publishDate));
}

export async function criticFeedQueue(): Promise<CriticFeedItem[]> {
  const rules = (await rulesSettings()).criticFeed;
  const rows = await candidates();
  return rows
    .filter((r): r is typeof r & { guid: string } => Boolean(r.guid))
    .sort((a, b) => (b.publishDate?.getTime() ?? 0) - (a.publishDate?.getTime() ?? 0))
    .map((r) => ({
      guid: r.guid,
      title: r.title,
      excerpt: r.excerpt,
      url: r.url,
      reviewDate: r.publishDate ? r.publishDate.toISOString().slice(0, 10) : null,
      outlet: { name: r.sourceName ?? 'Unknown outlet', slug: r.sourceSlug ?? null },
      game: { slug: r.gameSlug, name: r.gameName },
      suggestion: detectScore(r.title, r.excerpt, rules),
    }));
}

/** Confirm a score → a critic review (once per article), audited; ratings recompute. */
export async function scoreFeedItem(
  guid: string,
  input: {
    nativeScore: number;
    scaleMax: number;
    outletName?: string;
    reviewDate?: string;
    url?: string;
    gameSlug?: string;
  },
  actor: AuditActor,
): Promise<{ id: string; jobId: string | null }> {
  const [item] = await candidates(guid);
  if (!item?.guid)
    throw new CriticFeedError(404, 'Not in the queue (already scored, dismissed or not a review).');
  if (input.nativeScore > input.scaleMax) {
    throw new CriticFeedError(400, `The score cannot exceed the scale (${input.scaleMax}).`);
  }
  let gameId = item.gameId;
  if (input.gameSlug && input.gameSlug !== item.gameSlug) {
    const [g] = await db
      .select({ id: games.id })
      .from(games)
      .innerJoin(subjects, eq(subjects.id, games.subjectId))
      .where(eq(subjects.slug, input.gameSlug))
      .limit(1);
    if (!g) throw new CriticFeedError(400, `No game "${input.gameSlug}".`);
    gameId = g.id;
  }
  const rules = (await rulesSettings()).criticFeed;
  const suggestion = detectScore(item.title, item.excerpt, rules);
  const normalized = Math.max(
    0,
    Math.min(100, Math.round((input.nativeScore / input.scaleMax) * 100)),
  );
  let id: string;
  try {
    const [row] = await db
      .insert(gameCriticReviews)
      .values({
        gameId,
        outletName: (input.outletName ?? item.sourceName ?? 'Unknown outlet').slice(0, 200),
        sourceId: item.sourceId ?? null,
        score: normalized,
        nativeScore: input.nativeScore,
        nativeScaleMax: input.scaleMax,
        excerpt: item.excerpt ? item.excerpt.slice(0, 600) : null,
        url: input.url ?? item.url ?? null,
        reviewDate:
          input.reviewDate ??
          (item.publishDate ? item.publishDate.toISOString().slice(0, 10) : null),
        sourceArticleGuid: item.guid,
      })
      .returning({ id: gameCriticReviews.id });
    id = row!.id;
  } catch (err) {
    if (String((err as { cause?: { code?: string } }).cause?.code ?? '') === '23505') {
      throw new CriticFeedError(409, 'This review is already scored.');
    }
    throw err;
  }
  await writeAudit({
    action: 'create',
    entityType: 'game-critic-reviews',
    entityId: id,
    changes: {
      fromArticle: item.guid,
      confirmed: { nativeScore: input.nativeScore, scaleMax: input.scaleMax, score: normalized },
      suggested: suggestion
        ? {
            nativeScore: suggestion.nativeScore,
            scaleMax: suggestion.scaleMax,
            match: suggestion.match,
          }
        : null,
      suggestionAccepted:
        suggestion != null &&
        suggestion.nativeScore === input.nativeScore &&
        suggestion.scaleMax === input.scaleMax,
    },
    summary: `critic score from the review feed: ${item.sourceName ?? 'outlet'} → ${item.gameName} (${input.nativeScore}/${input.scaleMax})`,
    actor,
  });
  const jobId = (await enqueueRatingRecompute({ reason: 'critic-feed', gameId })) ?? null;
  return { id, jobId };
}

export async function dismissFeedItem(
  guid: string,
  note: string | undefined,
  actor: AuditActor,
): Promise<void> {
  const [item] = await candidates(guid);
  if (!item?.guid) throw new CriticFeedError(404, 'Not in the queue.');
  await db
    .insert(criticFeedDecisions)
    .values({
      articleGuid: item.guid,
      note: note ?? null,
      decidedByLabel: actor.label.slice(0, 120),
    })
    .onConflictDoNothing();
  await writeAudit({
    action: 'create',
    entityType: 'critic-feed-decision',
    entityId: item.guid.slice(0, 80),
    changes: { decision: 'dismissed', note: note ?? null },
    summary: `not a scored review: ${item.title.slice(0, 120)}`,
    actor,
  });
}

/** Undo a dismissal (the item returns to the queue). */
export async function restoreFeedItem(guid: string, actor: AuditActor): Promise<void> {
  const res = await db
    .delete(criticFeedDecisions)
    .where(eq(criticFeedDecisions.articleGuid, guid))
    .returning({ guid: criticFeedDecisions.articleGuid });
  if (res.length === 0) throw new CriticFeedError(404, 'No such dismissal.');
  await writeAudit({
    action: 'delete',
    entityType: 'critic-feed-decision',
    entityId: guid.slice(0, 80),
    changes: { decision: { from: 'dismissed', to: null } },
    summary: 'review back in the scoring queue',
    actor,
  });
}

export async function dismissedFeedItems(): Promise<
  { guid: string; note: string | null; decidedBy: string | null; decidedAt: string }[]
> {
  const rows = await db
    .select()
    .from(criticFeedDecisions)
    .orderBy(desc(criticFeedDecisions.decidedAt))
    .limit(100);
  return rows.map((r) => ({
    guid: r.articleGuid,
    note: r.note,
    decidedBy: r.decidedByLabel,
    decidedAt: r.decidedAt.toISOString(),
  }));
}
