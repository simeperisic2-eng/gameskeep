import { and, eq, sql, type AnyColumn } from 'drizzle-orm';
import type { EventKind } from '@gameskeep/shared/constants';
import { db } from '../db/client';
import { articles, articleTopics, topics, topicTimelineEvents } from '../db/schema';
import { slugTaken } from '../admin/crud';
import { summarizeTopic } from '../ai/client';
import { slugify } from '../lib/slug';
import type { CleanArticle } from './normalize';
import type { DetectedSignals } from './signals';
import { centroid, decideCluster, toVectorLiteral, type TopicCandidate } from './embedding';
import type { ClusterSettings } from './settings';
import { normalizeGameRef } from './event-kind';
import { shouldResistMerge } from './gate';
import { rulesSettings } from '../rules/settings';

/**
 * Phase P S3b: an editor's edit LOCKS a story field — the automatic passes keep
 * the editor's value. `lockedStatus(next)` writes `next` unless 'status' is locked.
 */
const lockedStatus = (next: string) =>
  sql`CASE WHEN 'status' = ANY(${topics.lockedFields}) THEN ${topics.status} ELSE ${next}::topic_status END`;
const lockedText = (field: 'tldr' | 'aiSummary', next: string | null) => {
  const col = field === 'tldr' ? topics.tldr : topics.aiSummary;
  return sql`CASE WHEN ${field} = ANY(${topics.lockedFields}) THEN ${col} ELSE ${next} END`;
};

/** Phase P S5: an approval survives only while its field is locked or its text unchanged. */
const keptApproval = (field: 'tldr' | 'aiSummary', next: string | null, approvalCol: AnyColumn) => {
  const col = field === 'tldr' ? topics.tldr : topics.aiSummary;
  return sql`CASE WHEN ${field} = ANY(${topics.lockedFields}) OR ${col} IS NOT DISTINCT FROM ${next} THEN ${approvalCol} ELSE NULL END`;
};

/**
 * Inputs the secondary gate (SPEC I4a §7) needs for an incoming article: its
 * primary game (normalized) + mechanical event kind. Computed in the pipeline and
 * passed in so the gate stays a pure decision and clustering does no mid-
 * transaction subject resolution.
 */
export interface GateInput {
  gameRef: string | null;
  eventKind: EventKind;
}

/**
 * The clustering engine's DB-side operations (SPEC I3 §3). For each new article:
 * embed → find the most-similar OPEN topic within the time window (pgvector
 * cosine) → attach if ≥ threshold else create a new topic → set the article's
 * PRIMARY topic → maintain the topic's centroid embedding, status and timeline.
 * Topic summaries are refreshed in a batch by the pipeline (off the request path,
 * never per-view) so we don't call the AI service once per attach.
 */

const CANDIDATE_LIMIT = 5;
// "Ongoing" from N articles is a rule (Phase P S3b: rules.clustering.ongoingAt).

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function dbRows<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows ?? (res as T[])) as T[];
}

/** Open topics within the time window, ranked by cosine similarity to `embedding`. */
export async function findCandidates(
  embedding: number[],
  publishDate: Date,
  settings: ClusterSettings,
): Promise<TopicCandidate[]> {
  const lit = toVectorLiteral(embedding);
  const windowStart = new Date(publishDate.getTime() - settings.timeWindowDays * 86_400_000);
  const res = await db.execute(sql`
    SELECT id, 1 - (embedding <=> ${lit}::vector) AS similarity
    FROM topics
    WHERE embedding IS NOT NULL
      AND status <> 'resolved'
      AND last_activity_at >= ${windowStart}
    ORDER BY embedding <=> ${lit}::vector ASC
    LIMIT ${CANDIDATE_LIMIT}
  `);
  return dbRows<{ id: string; similarity: number }>(res).map((r) => ({
    topicId: r.id,
    similarity: Number(r.similarity),
  }));
}

async function uniqueSlug(base: string): Promise<string> {
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

/** A candidate topic's secondary-gate fields (seed event + last activity). */
async function topicGateFields(topicId: string): Promise<{
  seedGameRef: string | null;
  seedEventKind: string | null;
  lastActivityAt: Date;
} | null> {
  const [row] = await db
    .select({
      seedGameRef: topics.seedGameRef,
      seedEventKind: topics.seedEventKind,
      lastActivityAt: topics.lastActivityAt,
    })
    .from(topics)
    .where(eq(topics.id, topicId))
    .limit(1);
  return row ?? null;
}

/** Insert the article row (idempotency is checked by the caller via guid). */
async function insertArticle(
  tx: Tx,
  clean: CleanArticle,
  signals: DetectedSignals,
  sourceId: string | null,
  embedding: number[],
  eventKind: EventKind,
): Promise<string> {
  // SEO slug must be unique; append a numeric suffix on collision.
  let slug = clean.slug;
  let n = 1;
  while (await slugTaken(articles, slug)) {
    n += 1;
    slug = `${clean.slug}-${n}`.slice(0, 200);
    if (n > 200) {
      slug = `${clean.slug}-${Date.now()}`.slice(0, 200);
      break;
    }
  }
  const [row] = await tx
    .insert(articles)
    .values({
      slug,
      externalGuid: clean.guid,
      sourceId,
      origin: 'aggregated',
      articleType: clean.articleType,
      title: clean.title,
      author: clean.author ?? null,
      url: clean.url ?? null,
      thumbnailUrl: clean.thumbnailUrl ?? null,
      excerpt: clean.excerpt ?? null,
      publishDate: clean.publishDate ?? null,
      isPaywalled: signals.isPaywalled,
      hasAffiliateLinks: signals.hasAffiliateLinks,
      isSponsored: signals.isSponsored,
      basedOnReviewCopy: signals.basedOnReviewCopy,
      eventKind,
      embedding,
    })
    .returning({ id: articles.id });
  if (!row) throw new Error('clusterArticle: article insert returned no row');
  return row.id;
}

async function addTimelineEvent(tx: Tx, topicId: string, clean: CleanArticle): Promise<void> {
  await tx.insert(topicTimelineEvents).values({
    topicId,
    occurredAt: clean.publishDate ?? new Date(),
    label: clean.title.slice(0, 300),
  });
}

export interface ClusterResult {
  articleId: string;
  topicId: string;
  action: 'attach' | 'create';
  similarity?: number;
  /** The secondary gate flipped a cosine "attach" into a "create" (SPEC I4a §7). */
  gateResisted: boolean;
}

/**
 * Cluster one already-embedded article: decide attach-vs-create, insert it, set
 * its primary topic, and update the topic. Runs in a transaction so a half-write
 * never leaves an orphan. Returns which topic it landed in (for the caller to
 * batch-refresh summaries).
 *
 * The SECONDARY GATE (SPEC I4a §7) runs between the cosine decision and the write:
 * when cosine says "attach", the gate may resist (same game + different event +
 * old-enough candidate → start a new topic instead). It only resists merges,
 * never forces one; editor merge/split still overrides.
 */
export async function clusterArticle(
  clean: CleanArticle,
  embedding: number[],
  signals: DetectedSignals,
  sourceId: string | null,
  settings: ClusterSettings,
  gateInput: GateInput,
): Promise<ClusterResult> {
  const { ongoingAt } = (await rulesSettings()).clustering;
  const publishDate = clean.publishDate ?? new Date();
  const candidates = await findCandidates(embedding, publishDate, settings);
  let decision = decideCluster(candidates, settings.similarityThreshold);

  // Secondary gate: re-examine a cosine "attach" against the candidate topic's
  // originating event before committing to the merge.
  let gateResisted = false;
  if (decision.action === 'attach' && decision.topicId && settings.gate.enabled) {
    const cand = await topicGateFields(decision.topicId);
    if (
      cand &&
      shouldResistMerge(
        {
          incoming: { gameRef: gateInput.gameRef, eventKind: gateInput.eventKind, publishDate },
          candidate: {
            gameRef: normalizeGameRef(cand.seedGameRef),
            eventKind: (cand.seedEventKind as EventKind | null) ?? 'other',
            lastActivityAt: cand.lastActivityAt,
          },
        },
        settings.gate,
      )
    ) {
      decision = { action: 'create' };
      gateResisted = true;
    }
  }

  return db.transaction(async (tx) => {
    const articleId = await insertArticle(
      tx,
      clean,
      signals,
      sourceId,
      embedding,
      gateInput.eventKind,
    );

    let topicId: string;
    if (decision.action === 'attach' && decision.topicId) {
      topicId = decision.topicId;
    } else {
      const slug = await uniqueSlug(clean.title);
      const [topic] = await tx
        .insert(topics)
        .values({
          slug,
          title: clean.title.slice(0, 300),
          status: 'developing',
          embedding,
          lastActivityAt: publishDate,
          // Seed the gate fields from this originating article (SPEC I4a §7).
          seedGameRef: gateInput.gameRef,
          seedEventKind: gateInput.eventKind,
        })
        .returning({ id: topics.id });
      if (!topic) throw new Error('clusterArticle: topic insert returned no row');
      topicId = topic.id;
    }

    // The article's PRIMARY (and only auto-assigned) topic.
    await tx
      .insert(articleTopics)
      .values({ articleId, topicId, isPrimary: true })
      .onConflictDoNothing();

    await addTimelineEvent(tx, topicId, clean);

    // Maintain the topic: recompute centroid from members, bump activity, and
    // flip developing → ongoing once it has enough coverage.
    const memberRows = await tx
      .select({ embedding: articles.embedding })
      .from(articleTopics)
      .innerJoin(articles, eq(articleTopics.articleId, articles.id))
      .where(eq(articleTopics.topicId, topicId));
    const vectors = memberRows
      .map((r) => r.embedding as number[] | null)
      .filter((v): v is number[] => Array.isArray(v));
    const newCentroid = vectors.length > 0 ? centroid(vectors) : embedding;

    const [{ count }] = (await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(articleTopics)
      .where(eq(articleTopics.topicId, topicId))) as [{ count: number }];

    await tx
      .update(topics)
      .set({
        embedding: newCentroid,
        lastActivityAt: sql`GREATEST(${topics.lastActivityAt}, ${publishDate})`,
        status: lockedStatus(count >= ongoingAt ? 'ongoing' : 'developing'),
      })
      .where(eq(topics.id, topicId));

    return {
      articleId,
      topicId,
      action: decision.action,
      similarity: decision.similarity,
      gateResisted,
    };
  });
}

/**
 * Recompute a topic's centroid embedding, article-count status and last-activity
 * from its current members (after an editor merge/split/reassign). Returns the
 * member count so the caller can delete a now-empty topic.
 */
export async function recomputeTopic(topicId: string): Promise<number> {
  const rows = await db
    .select({ embedding: articles.embedding, publishDate: articles.publishDate })
    .from(articleTopics)
    .innerJoin(articles, eq(articleTopics.articleId, articles.id))
    .where(eq(articleTopics.topicId, topicId));
  if (rows.length === 0) return 0;

  const vectors = rows
    .map((r) => r.embedding as number[] | null)
    .filter((v): v is number[] => Array.isArray(v));
  let lastActivity = new Date(0);
  for (const r of rows) {
    if (r.publishDate && r.publishDate > lastActivity) lastActivity = r.publishDate;
  }
  const { ongoingAt } = (await rulesSettings()).clustering;
  const patch: Record<string, unknown> = {
    status: lockedStatus(rows.length >= ongoingAt ? 'ongoing' : 'developing'),
  };
  if (vectors.length > 0) patch.embedding = centroid(vectors);
  if (lastActivity.getTime() > 0) patch.lastActivityAt = lastActivity;
  await db.update(topics).set(patch).where(eq(topics.id, topicId));
  return rows.length;
}

/** Refresh a topic's neutral TL;DR + AI summary from its current articles. */
export async function refreshTopicSummary(topicId: string): Promise<void> {
  const rows = await db
    .select({ title: articles.title, excerpt: articles.excerpt })
    .from(articleTopics)
    .innerJoin(articles, eq(articleTopics.articleId, articles.id))
    .where(eq(articleTopics.topicId, topicId))
    .limit(40);
  if (rows.length === 0) return;

  const { tldr, summary } = await summarizeTopic(
    rows.map((r) => ({ title: r.title, excerpt: r.excerpt ?? '' })),
  );
  const nextTldr = tldr.slice(0, 400) || null;
  const nextSummary = summary || null;
  await db
    .update(topics)
    .set({
      tldr: lockedText('tldr', nextTldr),
      aiSummary: lockedText('aiSummary', nextSummary),
      // Phase P S5: new automatic text → its approval lapses (the AI label is back).
      tldrApprovedAt: keptApproval('tldr', nextTldr, topics.tldrApprovedAt),
      tldrApprovedByLabel: keptApproval('tldr', nextTldr, topics.tldrApprovedByLabel),
      aiSummaryApprovedAt: keptApproval('aiSummary', nextSummary, topics.aiSummaryApprovedAt),
      aiSummaryApprovedByLabel: keptApproval(
        'aiSummary',
        nextSummary,
        topics.aiSummaryApprovedByLabel,
      ),
    })
    .where(eq(topics.id, topicId));
}

/**
 * Status auto-maintenance pass (BLUEPRINT 2.1): mark topics whose last activity
 * is older than the window as `resolved`. They're already excluded from new
 * clustering by the window filter; this just keeps the public status honest.
 */
export async function markStaleTopicsResolved(
  asOf: Date,
  settings: ClusterSettings,
): Promise<void> {
  const cutoff = new Date(asOf.getTime() - settings.timeWindowDays * 86_400_000);
  await db
    .update(topics)
    .set({ status: 'resolved' })
    .where(
      and(
        sql`${topics.lastActivityAt} < ${cutoff}`,
        sql`${topics.status} <> 'resolved'`,
        sql`NOT ('status' = ANY(${topics.lockedFields}))`,
      ),
    );
}
