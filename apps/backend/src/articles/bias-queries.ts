import { desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { BiasBreakdown } from '@gameskeep/shared/constants';
import { db } from '../db/client';
import { articles, sources, topics } from '../db/schema';
import { getBiasWeights, type BiasWeights } from './bias-settings';
import { getClusterSettings, type ClusterGateSettings } from './settings';
import { readBiasRecomputeState, type BiasRecomputeState } from './jobs';
import { toPublicBias, type PublicArticleBias } from './bias';

/**
 * Read-side bias queries (SPEC I4a inspection surfaces). Shared by the admin
 * routes, the admin UI and the verify script so "what the engine scored + why"
 * has one definition. The admin view (`AdminArticleBias`) includes the
 * INTERNAL-only field by design (it's behind the admin token); the PUBLIC view
 * goes exclusively through `toPublicBias`, which cannot include it.
 */

function dbScalar(res: unknown): number {
  const rows = ((res as { rows?: { n: number | string }[] }).rows ??
    (res as { n: number | string }[])) as { n: number | string }[];
  return rows[0] ? Number(rows[0].n) : 0;
}

export interface BiasStatus {
  weights: BiasWeights;
  gate: ClusterGateSettings;
  eventKinds: string[];
  counts: {
    articlesScored: number;
    articlesWithOverride: number;
    topicsWithDistribution: number;
  };
  lastRecompute: BiasRecomputeState | null;
}

export async function getBiasStatus(): Promise<BiasStatus> {
  const [weights, settings, lastRecompute] = await Promise.all([
    getBiasWeights(),
    getClusterSettings(),
    readBiasRecomputeState(),
  ]);
  const [articlesScored, articlesWithOverride, topicsWithDistribution] = await Promise.all([
    db
      .execute(sql`SELECT count(*)::int AS n FROM articles WHERE influence_score IS NOT NULL`)
      .then(dbScalar),
    db
      .execute(
        sql`SELECT count(*)::int AS n FROM articles WHERE influence_override IS NOT NULL OR quality_override IS NOT NULL`,
      )
      .then(dbScalar),
    db
      .execute(sql`SELECT count(*)::int AS n FROM topics WHERE bias_distribution IS NOT NULL`)
      .then(dbScalar),
  ]);
  return {
    weights,
    gate: settings.gate,
    eventKinds: Object.keys(settings.eventKindLexicon),
    counts: { articlesScored, articlesWithOverride, topicsWithDistribution },
    lastRecompute,
  };
}

export interface AdminArticleBias {
  id: string;
  guid: string | null;
  slug: string;
  title: string;
  sourceSlug: string | null;
  articleType: string;
  eventKind: string | null;
  signals: {
    isSponsored: boolean;
    hasAffiliateLinks: boolean;
    basedOnReviewCopy: boolean;
    isPaywalled: boolean;
  };
  influence: { auto: number | null; override: number | null; effective: number | null };
  quality: { auto: number | null; override: number | null; effective: number | null };
  influenceBreakdown: BiasBreakdown | null;
  qualityBreakdown: BiasBreakdown | null;
  influenceOverrideReason: string | null;
  qualityOverrideReason: string | null;
  editorNote: string | null;
  /** INTERNAL ONLY — present here only because this is the admin (token) surface. */
  internalAssessment: string | null;
}

const ADMIN_BIAS_COLUMNS = {
  id: articles.id,
  guid: articles.externalGuid,
  slug: articles.slug,
  title: articles.title,
  sourceSlug: sources.slug,
  articleType: articles.articleType,
  eventKind: articles.eventKind,
  isSponsored: articles.isSponsored,
  hasAffiliateLinks: articles.hasAffiliateLinks,
  basedOnReviewCopy: articles.basedOnReviewCopy,
  isPaywalled: articles.isPaywalled,
  influenceScore: articles.influenceScore,
  qualityScore: articles.qualityScore,
  influenceOverride: articles.influenceOverride,
  qualityOverride: articles.qualityOverride,
  influenceBreakdown: articles.influenceBreakdown,
  qualityBreakdown: articles.qualityBreakdown,
  influenceOverrideReason: articles.influenceOverrideReason,
  qualityOverrideReason: articles.qualityOverrideReason,
  editorNote: articles.editorNote,
  internalAssessment: articles.internalAssessment,
} as const;

function shapeAdmin(r: Record<string, unknown>): AdminArticleBias {
  const influenceAuto = (r.influenceScore as number | null) ?? null;
  const influenceOverride = (r.influenceOverride as number | null) ?? null;
  const qualityAuto = (r.qualityScore as number | null) ?? null;
  const qualityOverride = (r.qualityOverride as number | null) ?? null;
  return {
    id: String(r.id),
    guid: (r.guid as string | null) ?? null,
    slug: String(r.slug),
    title: String(r.title),
    sourceSlug: (r.sourceSlug as string | null) ?? null,
    articleType: String(r.articleType),
    eventKind: (r.eventKind as string | null) ?? null,
    signals: {
      isSponsored: Boolean(r.isSponsored),
      hasAffiliateLinks: Boolean(r.hasAffiliateLinks),
      basedOnReviewCopy: Boolean(r.basedOnReviewCopy),
      isPaywalled: Boolean(r.isPaywalled),
    },
    influence: {
      auto: influenceAuto,
      override: influenceOverride,
      effective: influenceOverride ?? influenceAuto,
    },
    quality: {
      auto: qualityAuto,
      override: qualityOverride,
      effective: qualityOverride ?? qualityAuto,
    },
    influenceBreakdown: (r.influenceBreakdown as BiasBreakdown | null) ?? null,
    qualityBreakdown: (r.qualityBreakdown as BiasBreakdown | null) ?? null,
    influenceOverrideReason: (r.influenceOverrideReason as string | null) ?? null,
    qualityOverrideReason: (r.qualityOverrideReason as string | null) ?? null,
    editorNote: (r.editorNote as string | null) ?? null,
    internalAssessment: (r.internalAssessment as string | null) ?? null,
  };
}

/** Admin list of articles with their bias (auto/override/effective + breakdowns). */
export async function listArticleBias(limit = 500): Promise<AdminArticleBias[]> {
  const rows = await db
    .select(ADMIN_BIAS_COLUMNS)
    .from(articles)
    .leftJoin(sources, eq(articles.sourceId, sources.id))
    .where(isNotNull(articles.influenceScore))
    .orderBy(desc(articles.influenceScore))
    .limit(limit);
  return rows.map((r) => shapeAdmin(r as Record<string, unknown>));
}

export async function getArticleBiasAdmin(id: string): Promise<AdminArticleBias | null> {
  const rows = await db
    .select(ADMIN_BIAS_COLUMNS)
    .from(articles)
    .leftJoin(sources, eq(articles.sourceId, sources.id))
    .where(eq(articles.id, id))
    .limit(1);
  const row = rows[0] as Record<string, unknown> | undefined;
  return row ? shapeAdmin(row) : null;
}

/**
 * The PUBLIC bias payload for one article (SPEC I4a §4). Selects an explicit
 * column list that OMITS `internal_assessment`, then runs it through the
 * allowlist serializer — so the internal field is structurally absent twice over.
 */
export async function getArticleBiasPublic(id: string): Promise<PublicArticleBias | null> {
  const [row] = await db
    .select({
      influenceScore: articles.influenceScore,
      qualityScore: articles.qualityScore,
      influenceOverride: articles.influenceOverride,
      qualityOverride: articles.qualityOverride,
      influenceBreakdown: articles.influenceBreakdown,
      qualityBreakdown: articles.qualityBreakdown,
      editorNote: articles.editorNote,
    })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);
  if (!row) return null;
  return toPublicBias(row);
}

export interface TopicBiasView {
  id: string;
  slug: string;
  title: string;
  articleCount: number;
  derivedInfluencePct: number | null;
  derivedQualityPct: number | null;
  distribution: import('@gameskeep/shared/constants').TopicBiasDistribution | null;
}

/** Topics with their stored bias distribution (the "bias bar" data for I5). */
export async function listTopicBias(limit = 500): Promise<TopicBiasView[]> {
  const rows = await db
    .select({
      id: topics.id,
      slug: topics.slug,
      title: topics.title,
      derivedInfluencePct: topics.derivedInfluencePct,
      derivedQualityPct: topics.derivedQualityPct,
      distribution: topics.biasDistribution,
    })
    .from(topics)
    .where(isNotNull(topics.biasDistribution))
    .limit(limit);
  return rows
    .map((r) => ({
      ...r,
      articleCount: r.distribution?.articleCount ?? 0,
    }))
    .sort((a, b) => b.articleCount - a.articleCount);
}
