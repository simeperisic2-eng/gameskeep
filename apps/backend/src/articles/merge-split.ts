import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { articles, articleTopics, topics } from '../db/schema';
import { slugTaken } from '../admin/crud';
import { slugify } from '../lib/slug';
import { writeAudit, type AuditActor } from '../admin/audit';
import { recomputeTopic, refreshTopicSummary } from './cluster';

/**
 * Editor merge / split / reassign (SPEC I3 §4 — MANDATORY: no auto-clustering is
 * perfect). Every action is audit-logged and the affected topics' centroids and
 * summaries are recomputed so the public view stays consistent. These are the
 * human override on top of the automatic engine (CLAUDE.md auto + manual rule).
 */

async function getTopic(id: string): Promise<{ id: string; title: string } | null> {
  const [row] = await db
    .select({ id: topics.id, title: topics.title })
    .from(topics)
    .where(eq(topics.id, id))
    .limit(1);
  return row ?? null;
}

async function uniqueTopicSlug(base: string): Promise<string> {
  const root = slugify(base).slice(0, 150) || 'topic';
  let candidate = root;
  let n = 1;
  while (await slugTaken(topics, candidate)) {
    n += 1;
    candidate = `${root}-${n}`;
    if (n > 200) {
      candidate = `${root}-${Date.now()}`;
      break;
    }
  }
  return candidate;
}

export interface MergeResult {
  targetTopicId: string;
  movedArticles: number;
}

/**
 * Merge `sourceTopicId` INTO `targetTopicId`: move all its article links to the
 * target (a moved primary stays primary on the target), then delete the source.
 */
export async function mergeTopics(
  sourceTopicId: string,
  targetTopicId: string,
  actor: AuditActor,
): Promise<MergeResult | null> {
  if (sourceTopicId === targetTopicId) return null;
  const [source, target] = await Promise.all([getTopic(sourceTopicId), getTopic(targetTopicId)]);
  if (!source || !target) return null;

  const moved = await db.transaction(async (tx) => {
    const links = await tx
      .select()
      .from(articleTopics)
      .where(eq(articleTopics.topicId, sourceTopicId));
    let count = 0;
    for (const link of links) {
      const [existing] = await tx
        .select()
        .from(articleTopics)
        .where(
          and(
            eq(articleTopics.articleId, link.articleId),
            eq(articleTopics.topicId, targetTopicId),
          ),
        )
        .limit(1);
      if (existing) {
        // Article already on target — keep the stronger primary, drop the source row.
        if (link.isPrimary && !existing.isPrimary) {
          await tx
            .update(articleTopics)
            .set({ isPrimary: true })
            .where(
              and(
                eq(articleTopics.articleId, link.articleId),
                eq(articleTopics.topicId, targetTopicId),
              ),
            );
        }
        await tx
          .delete(articleTopics)
          .where(
            and(
              eq(articleTopics.articleId, link.articleId),
              eq(articleTopics.topicId, sourceTopicId),
            ),
          );
      } else {
        await tx
          .update(articleTopics)
          .set({ topicId: targetTopicId })
          .where(
            and(
              eq(articleTopics.articleId, link.articleId),
              eq(articleTopics.topicId, sourceTopicId),
            ),
          );
      }
      count += 1;
    }
    // Source is now empty of links it owns; delete it (cascades any leftovers).
    await tx.delete(topics).where(eq(topics.id, sourceTopicId));
    return count;
  });

  await recomputeTopic(targetTopicId);
  await refreshTopicSummary(targetTopicId);

  await writeAudit({
    action: 'update',
    entityType: 'topics',
    entityId: targetTopicId,
    changes: { merged_from: { id: sourceTopicId, title: source.title }, movedArticles: moved },
    summary: `merged topic "${source.title}" into "${target.title}" (${moved} articles)`,
    actor,
  });
  await writeAudit({
    action: 'delete',
    entityType: 'topics',
    entityId: sourceTopicId,
    changes: { merged_into: targetTopicId },
    summary: `topic "${source.title}" removed by merge into "${target.title}"`,
    actor,
  });

  return { targetTopicId, movedArticles: moved };
}

export interface SplitResult {
  newTopicId: string;
  movedArticles: number;
}

/**
 * Split `articleIds` OUT of `topicId` into a brand-new topic (the engine wrongly
 * lumped them together). The moved articles become primary on the new topic.
 */
export async function splitTopic(
  topicId: string,
  articleIds: string[],
  newTitle: string | undefined,
  actor: AuditActor,
): Promise<SplitResult | null> {
  const source = await getTopic(topicId);
  if (!source) return null;

  // Only move articles that are actually in this topic.
  const present = await db
    .select({ articleId: articleTopics.articleId })
    .from(articleTopics)
    .where(and(eq(articleTopics.topicId, topicId), inArray(articleTopics.articleId, articleIds)));
  const moveIds = present.map((r) => r.articleId);
  if (moveIds.length === 0) return null;

  // Title the new topic from a moved article if not supplied.
  const [firstArticle] = await db
    .select({ title: articles.title })
    .from(articles)
    .where(eq(articles.id, moveIds[0]!))
    .limit(1);
  const title = (newTitle ?? firstArticle?.title ?? source.title).slice(0, 300);
  const slug = await uniqueTopicSlug(title);

  const newTopicId = await db.transaction(async (tx) => {
    const [topic] = await tx
      .insert(topics)
      .values({ slug, title, status: 'developing' })
      .returning({ id: topics.id });
    if (!topic) throw new Error('splitTopic: topic insert returned no row');
    // Repoint the chosen articles to the new topic, primary there.
    await tx
      .update(articleTopics)
      .set({ topicId: topic.id, isPrimary: true })
      .where(and(eq(articleTopics.topicId, topicId), inArray(articleTopics.articleId, moveIds)));
    return topic.id;
  });

  await recomputeTopic(newTopicId);
  await refreshTopicSummary(newTopicId);
  const remaining = await recomputeTopic(topicId);
  if (remaining > 0) await refreshTopicSummary(topicId);

  await writeAudit({
    action: 'update',
    entityType: 'topics',
    entityId: newTopicId,
    changes: { split_from: { id: topicId, title: source.title }, movedArticles: moveIds.length },
    summary: `split ${moveIds.length} articles out of "${source.title}" into "${title}"`,
    actor,
  });

  return { newTopicId, movedArticles: moveIds.length };
}

/** Move an article to a different topic; optionally make it the primary there. */
export async function reassignArticle(
  articleId: string,
  topicId: string,
  makePrimary: boolean,
  actor: AuditActor,
): Promise<boolean> {
  const [target, article] = await Promise.all([
    getTopic(topicId),
    db.select({ id: articles.id }).from(articles).where(eq(articles.id, articleId)).limit(1),
  ]);
  if (!target || article.length === 0) return false;

  // The topic(s) the article currently belongs to (to recompute afterwards).
  const before = await db
    .select({ topicId: articleTopics.topicId, isPrimary: articleTopics.isPrimary })
    .from(articleTopics)
    .where(eq(articleTopics.articleId, articleId));
  const affected = new Set<string>(before.map((b) => b.topicId));
  affected.add(topicId);

  await db.transaction(async (tx) => {
    if (makePrimary) {
      // Enforce one primary per article: demote all, then set the chosen link.
      await tx
        .update(articleTopics)
        .set({ isPrimary: false })
        .where(eq(articleTopics.articleId, articleId));
    }
    await tx
      .insert(articleTopics)
      .values({ articleId, topicId, isPrimary: makePrimary })
      .onConflictDoUpdate({
        target: [articleTopics.articleId, articleTopics.topicId],
        set: { isPrimary: makePrimary },
      });
  });

  for (const id of affected) {
    const count = await recomputeTopic(id);
    if (count > 0) await refreshTopicSummary(id);
  }

  await writeAudit({
    action: 'update',
    entityType: 'articles',
    entityId: articleId,
    changes: { reassignedTo: topicId, makePrimary },
    summary: `reassigned article to topic "${target.title}"${makePrimary ? ' (primary)' : ''}`,
    actor,
  });
  return true;
}
