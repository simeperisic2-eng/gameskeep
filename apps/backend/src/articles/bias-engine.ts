import { eq, inArray, sql } from 'drizzle-orm';
import type { ArticleType } from '@gameskeep/shared/constants';
import { db } from '../db/client';
import { articles, articleSubjects, articleTopics, games, sources, topics } from '../db/schema';
import { writeAudit, type AuditActor } from '../admin/audit';
import {
  aggregateDistribution,
  computeInfluence,
  computeQuality,
  type ArticleEffectiveScore,
  type BiasSignalInputs,
} from './bias';
import { getBiasWeights, type BiasWeights } from './bias-settings';

/**
 * The bias engine's DB-side operations (SPEC I4a). All heavy work runs in the
 * background (the I3 pipeline calls `recomputeBias` at the end; admin re-tunes
 * trigger a recompute job) and is stored — users always read pre-computed scores
 * (CLAUDE.md speed rule). Re-tuning recomputes the AUTO scores + breakdowns but
 * NEVER touches an editor override (auto + manual override rule).
 */

export interface RecomputeResult {
  articlesScored: number;
  topicsAggregated: number;
}

function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * Map article id → does its source's parent company publish one of the games it
 * covers (a conflict of interest)? Loaded in two batch queries rather than per
 * article. In demo this rarely fires (the 10 outlets' parents don't publish the
 * games) — implemented correctly, dormant until the data supports it.
 */
async function loadConflictMap(): Promise<Set<string>> {
  // source id → parent company (normalized)
  const sourceRows = await db
    .select({ id: sources.id, parent: sources.parentCompany })
    .from(sources);
  const parentBySource = new Map<string, string>();
  for (const r of sourceRows) {
    const p = norm(r.parent);
    if (p) parentBySource.set(r.id, p);
  }
  if (parentBySource.size === 0) return new Set();

  // article id → source id + the publishers of its linked games
  const rows = await db
    .select({
      articleId: articleSubjects.articleId,
      sourceId: articles.sourceId,
      publisher: games.publisher,
    })
    .from(articleSubjects)
    .innerJoin(articles, eq(articleSubjects.articleId, articles.id))
    .innerJoin(games, eq(games.subjectId, articleSubjects.subjectId));

  const conflicted = new Set<string>();
  for (const r of rows) {
    if (!r.sourceId) continue;
    const parent = parentBySource.get(r.sourceId);
    if (!parent) continue;
    const pub = norm(r.publisher);
    if (pub && (pub.includes(parent) || parent.includes(pub))) conflicted.add(r.articleId);
  }
  return conflicted;
}

/** Recompute the AUTO influence/quality scores + breakdowns for every article. */
async function recomputeArticleBias(weights: BiasWeights): Promise<number> {
  const sourceRows = await db
    .select({
      id: sources.id,
      commercial: sources.reputationCommercial,
      general: sources.reputationGeneral,
    })
    .from(sources);
  const sourceById = new Map(sourceRows.map((s) => [s.id, s]));

  const conflicted = await loadConflictMap();

  const rows = await db
    .select({
      id: articles.id,
      sourceId: articles.sourceId,
      articleType: articles.articleType,
      isSponsored: articles.isSponsored,
      hasAffiliateLinks: articles.hasAffiliateLinks,
      basedOnReviewCopy: articles.basedOnReviewCopy,
      isPaywalled: articles.isPaywalled,
    })
    .from(articles);

  let scored = 0;
  for (const a of rows) {
    const src = a.sourceId ? sourceById.get(a.sourceId) : undefined;
    const inputs: BiasSignalInputs = {
      isSponsored: a.isSponsored,
      hasAffiliateLinks: a.hasAffiliateLinks,
      basedOnReviewCopy: a.basedOnReviewCopy,
      isPaywalled: a.isPaywalled,
      articleType: a.articleType as ArticleType,
      sourceConflict: conflicted.has(a.id),
      reputationCommercial: src?.commercial ?? null,
      reputationGeneral: src?.general ?? null,
    };
    const influence = computeInfluence(inputs, weights.influence);
    const quality = computeQuality(inputs, weights.quality);
    try {
      await db
        .update(articles)
        .set({
          influenceScore: influence.score,
          qualityScore: quality.score,
          influenceBreakdown: influence,
          qualityBreakdown: quality,
        })
        .where(eq(articles.id, a.id));
      scored += 1;
    } catch {
      // One bad row must never abort the whole recompute (anti-bug rule).
    }
  }
  return scored;
}

/**
 * Recompute the stored bias distribution for the given topics (or all topics).
 * Uses EFFECTIVE per-article scores (editor override ?? auto), so overrides flow
 * straight into the topic bar.
 */
export async function recomputeTopicsBias(
  weights: BiasWeights,
  topicIds?: string[],
): Promise<number> {
  const topicRows =
    topicIds && topicIds.length > 0
      ? await db.select({ id: topics.id }).from(topics).where(inArray(topics.id, topicIds))
      : await db.select({ id: topics.id }).from(topics);
  if (topicRows.length === 0) return 0;

  // article id → effective scores, joined to its topics in one pass.
  const links = await db
    .select({
      topicId: articleTopics.topicId,
      influence: sql<
        number | null
      >`COALESCE(${articles.influenceOverride}, ${articles.influenceScore})`,
      quality: sql<number | null>`COALESCE(${articles.qualityOverride}, ${articles.qualityScore})`,
    })
    .from(articleTopics)
    .innerJoin(articles, eq(articleTopics.articleId, articles.id));

  const byTopic = new Map<string, ArticleEffectiveScore[]>();
  for (const l of links) {
    const list = byTopic.get(l.topicId) ?? [];
    list.push({
      influence: l.influence == null ? null : Number(l.influence),
      quality: l.quality == null ? null : Number(l.quality),
    });
    byTopic.set(l.topicId, list);
  }

  let updated = 0;
  for (const t of topicRows) {
    const scores = byTopic.get(t.id) ?? [];
    const dist = aggregateDistribution(scores, weights.buckets);
    try {
      await db
        .update(topics)
        .set({
          biasDistribution: dist,
          derivedInfluencePct: dist.influence.avg,
          derivedQualityPct: dist.quality.avg,
        })
        .where(eq(topics.id, t.id));
      updated += 1;
    } catch {
      /* skip a bad topic, keep going */
    }
  }
  return updated;
}

/** Full recompute: every article's auto score, then every topic's distribution. */
export async function recomputeBias(): Promise<RecomputeResult> {
  const weights = await getBiasWeights();
  const articlesScored = await recomputeArticleBias(weights);
  const topicsAggregated = await recomputeTopicsBias(weights);
  return { articlesScored, topicsAggregated };
}

// ── editor controls (auto + manual override, all audit-logged) ───────────────

async function topicIdsForArticle(articleId: string): Promise<string[]> {
  const rows = await db
    .select({ topicId: articleTopics.topicId })
    .from(articleTopics)
    .where(eq(articleTopics.articleId, articleId));
  return rows.map((r) => r.topicId);
}

export interface BiasOverridePatch {
  influenceScore?: number | null;
  qualityScore?: number | null;
  reason?: string;
}

/**
 * Editor override of an axis score (SPEC I4a §6). Marks the axis editor-set
 * (distinct from auto), retains the auto value underneath, audit-logs old→new,
 * and refreshes the affected topics' distributions. Passing `null` clears the
 * override (revert to auto).
 */
export async function setArticleBiasOverride(
  articleId: string,
  patch: BiasOverridePatch,
  actor: AuditActor,
): Promise<boolean> {
  const [before] = await db
    .select({
      id: articles.id,
      influenceOverride: articles.influenceOverride,
      qualityOverride: articles.qualityOverride,
    })
    .from(articles)
    .where(eq(articles.id, articleId))
    .limit(1);
  if (!before) return false;

  const set: Record<string, unknown> = {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const reason = patch.reason?.slice(0, 2000) ?? null;
  if (patch.influenceScore !== undefined) {
    set.influenceOverride = patch.influenceScore;
    set.influenceOverrideReason = patch.influenceScore === null ? null : reason;
    changes.influenceOverride = { from: before.influenceOverride, to: patch.influenceScore };
  }
  if (patch.qualityScore !== undefined) {
    set.qualityOverride = patch.qualityScore;
    set.qualityOverrideReason = patch.qualityScore === null ? null : reason;
    changes.qualityOverride = { from: before.qualityOverride, to: patch.qualityScore };
  }
  if (Object.keys(set).length === 0) return false;

  await db.update(articles).set(set).where(eq(articles.id, articleId));

  // Effective scores changed → refresh just this article's topics.
  const weights = await getBiasWeights();
  await recomputeTopicsBias(weights, await topicIdsForArticle(articleId));

  await writeAudit({
    action: 'update',
    entityType: 'articles',
    entityId: articleId,
    changes: { ...changes, reason },
    summary: `bias override (${Object.keys(changes).join(', ') || 'none'})`,
    actor,
  });
  return true;
}

/**
 * Set/clear the editor JUDGMENTAL note (SPEC I4a §3). This is the ONLY way a
 * judgmental label ("cozy vibes, not gameplay") enters the system — a human wrote
 * it; the engine never invents one. Public-eligible (I5). Audit-logged.
 */
export async function setArticleEditorNote(
  articleId: string,
  editorNote: string | null,
  actor: AuditActor,
): Promise<boolean> {
  const [before] = await db
    .select({ editorNote: articles.editorNote })
    .from(articles)
    .where(eq(articles.id, articleId))
    .limit(1);
  if (!before) return false;
  await db
    .update(articles)
    .set({ editorNote: editorNote?.slice(0, 2000) ?? null })
    .where(eq(articles.id, articleId));
  await writeAudit({
    action: 'update',
    entityType: 'articles',
    entityId: articleId,
    changes: { editorNote: { from: before.editorNote, to: editorNote ?? null } },
    summary: 'set editor bias note',
    actor,
  });
  return true;
}

/**
 * Set/clear the INTERNAL-ONLY assessment (SPEC I4a §4). Written only through this
 * admin-scoped function; it is NEVER part of any public payload (the public
 * serializer `toPublicBias` can't reference it). Audit-logged.
 */
export async function setArticleInternalAssessment(
  articleId: string,
  internalAssessment: string | null,
  actor: AuditActor,
): Promise<boolean> {
  const [before] = await db
    .select({ internalAssessment: articles.internalAssessment })
    .from(articles)
    .where(eq(articles.id, articleId))
    .limit(1);
  if (!before) return false;
  await db
    .update(articles)
    .set({ internalAssessment: internalAssessment?.slice(0, 5000) ?? null })
    .where(eq(articles.id, articleId));
  await writeAudit({
    action: 'update',
    entityType: 'articles',
    entityId: articleId,
    // Audit records that it changed, not the sensitive text itself.
    changes: { internalAssessment: { changed: true } },
    summary: 'set internal-only assessment',
    actor,
  });
  return true;
}
