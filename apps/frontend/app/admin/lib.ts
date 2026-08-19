/**
 * Server-side helpers for the Control Panel (SPEC I8, Slice 1). Reads forward the
 * logged-in STAFF's session cookie to the backend, which applies I6 RBAC per the
 * staff's rank — the old demo-admin-token read path is retired (that token is now
 * automation/verify only). Writes go through the same-origin BFF (which also
 * forwards the session + CSRF). Non-staff never reach here (the admin layout gate
 * redirects them to login first).
 */
import { cookies } from 'next/headers';

const BACKEND = process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:4000';

export interface FieldSpec {
  name: string;
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'enum' | 'json' | 'date' | 'datetime' | 'ref';
  required?: boolean;
  options?: string[];
  ref?: string;
  help?: string;
}

export interface ResourceMeta {
  name: string;
  label: string;
  labelColumn: string;
  hasSlug: boolean;
  fields: FieldSpec[];
}

export interface AdminMeta {
  resources: ResourceMeta[];
  vectorColumns: { table: string; column: string }[];
}

export type Row = Record<string, unknown>;

async function adminGet<T>(path: string): Promise<T> {
  const cookieHeader = (await cookies()).toString();
  const res = await fetch(`${BACKEND}/admin/api${path}`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`admin API ${path} → HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export function getMeta(): Promise<AdminMeta> {
  return adminGet<AdminMeta>('/_meta');
}

// ── dashboard (I8 Slice 1) ────────────────────────────────────────────────────
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
  activity: {
    windowDays: number;
    ratings: number;
    comments: number;
    votes: number;
    newUsers: number;
  };
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
  const res = await adminGet<{ data: DashboardData }>('/dashboard');
  return res.data;
}

export async function listResource(name: string): Promise<Row[]> {
  const res = await adminGet<{ data: Row[] }>(`/${name}`);
  return res.data;
}

export async function getResourceRow(name: string, id: string): Promise<Row | null> {
  try {
    const res = await adminGet<{ data: Row }>(`/${name}/${encodeURIComponent(id)}`);
    return res.data;
  } catch {
    return null;
  }
}

export function findResource(meta: AdminMeta, name: string): ResourceMeta | undefined {
  return meta.resources.find((r) => r.name === name);
}

// ── clustering (I3) ───────────────────────────────────────────────────────────
export interface ClusterSettings {
  similarityThreshold: number;
  timeWindowDays: number;
}

export interface ClusterStatus {
  provider: { provider: string; live: boolean; sources: number };
  settings: ClusterSettings;
  totalArticles: number;
  aggregatedArticles: number;
  feedArticles: number;
  articlesWithEmbedding: number;
  articlesWithPrimaryTopic: number;
  totalTopics: number;
  topicsWithSummary: number;
  multiSourceTopics: number;
  articlesWithGame: number;
  lastIngest: { finishedAt?: string; newArticles?: number; reason?: string } | null;
}

export interface ClusterArticle {
  id: string;
  guid: string | null;
  title: string;
  sourceSlug: string | null;
  isPrimary: boolean;
  hasEmbedding: boolean;
}

export interface ClusterTopic {
  id: string;
  slug: string;
  title: string;
  tldr: string | null;
  aiSummary: string | null;
  status: string;
  articleCount: number;
  sources: string[];
  articles: ClusterArticle[];
}

export function getClusterStatus(): Promise<ClusterStatus> {
  return adminGet<ClusterStatus>('/clustering/status');
}

export async function listClusterTopics(): Promise<ClusterTopic[]> {
  const res = await adminGet<{ data: ClusterTopic[] }>('/clustering/topics');
  return res.data;
}

// ── bias engine (I4a) ─────────────────────────────────────────────────────────
export interface BiasContribution {
  signal: string;
  label: string;
  points: number;
}
export interface BiasBreakdown {
  baseline: number;
  rawSum: number;
  score: number;
  contributions: BiasContribution[];
}
export interface BiasGateSettings {
  enabled: boolean;
  minEventGapDays: number;
  requireDifferentEventKind: boolean;
}
export interface BiasWeights {
  influence: Record<string, number>;
  quality: Record<string, number>;
  buckets: { influenceMidpoint: number; qualityMidpoint: number };
}
export interface BiasStatus {
  weights: BiasWeights;
  gate: BiasGateSettings;
  eventKinds: string[];
  counts: { articlesScored: number; articlesWithOverride: number; topicsWithDistribution: number };
  lastRecompute: { finishedAt?: string; reason?: string; articlesScored?: number } | null;
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
  internalAssessment: string | null;
}
export interface TopicBiasView {
  id: string;
  slug: string;
  title: string;
  articleCount: number;
  derivedInfluencePct: number | null;
  derivedQualityPct: number | null;
  distribution: {
    articleCount: number;
    influence: { independent: number; influenced: number; avg: number | null };
    quality: { top: number; slop: number; avg: number | null };
  } | null;
}

export function getBiasStatus(): Promise<BiasStatus> {
  return adminGet<BiasStatus>('/bias/status');
}
export async function listArticleBias(): Promise<AdminArticleBias[]> {
  const res = await adminGet<{ data: AdminArticleBias[] }>('/bias/articles');
  return res.data;
}
export async function listTopicBias(): Promise<TopicBiasView[]> {
  const res = await adminGet<{ data: TopicBiasView[] }>('/bias/topics');
  return res.data;
}

// ── rating engine (I4b) ─────────────────────────────────────────────────────
export interface CommunityBurstInfo {
  isBurst: boolean;
  flagged: boolean;
  windowHours: number;
  windowCount: number;
  historicalRate: number;
  extremeFraction: number;
  naive: number | null;
  weighted: number | null;
  dampedVoteCount: number;
}
interface RatingLayer {
  score: number | null;
  hasData: boolean;
  count?: number;
}
export interface AdminGameRating {
  gameId: string;
  name: string;
  slug: string;
  our: RatingLayer;
  critics: RatingLayer & { auto: number | null; override: number | null };
  community: RatingLayer & {
    auto: number | null;
    naive: number | null;
    override: number | null;
    burstFlag: boolean;
    burstFlagAuto: boolean;
    burstInfo: CommunityBurstInfo | null;
  };
  web: RatingLayer;
  disconnect: {
    value: number | null;
    band: string | null;
    contextTag: string | null;
    ourVsCritics: number | null;
    communityVsWeb: number | null;
    hasData: boolean;
  };
  contentFlags: {
    aiAssets: string | null;
    launchState: string | null;
    monetization: {
      microtransactions: boolean;
      battlePass: boolean;
      lootBoxesOrGacha: boolean;
      payToWinPredatory: boolean;
    };
    complexity: number | null;
    dlc: { name: string; priceCents: number | null; currency: string }[];
  } | null;
  computedAt: string | null;
}
export interface RatingStatus {
  settings: {
    credibility: Record<string, number>;
    burst: Record<string, number>;
    disconnect: Record<string, number>;
  };
  counts: { gamesWithSummary: number; gamesWithCommunity: number; gamesFlagged: number };
  lastRecompute: { finishedAt?: string; reason?: string; gamesProcessed?: number } | null;
}
export interface VoteWeightView {
  username: string | null;
  score: number;
  ratedAt: string;
  credibility: { email: number; activity: number; age: number; playtime: number; total: number };
  inWindow: boolean;
  inFlaggedBurst: boolean;
  effectiveWeight: number;
}

export function getRatingStatus(): Promise<RatingStatus> {
  return adminGet<RatingStatus>('/ratings/status');
}
export async function listGameRatings(): Promise<AdminGameRating[]> {
  const res = await adminGet<{ data: AdminGameRating[] }>('/ratings/games');
  return res.data;
}
export async function getGameVotes(
  gameId: string,
): Promise<{ votes: VoteWeightView[]; flagged: boolean }> {
  const res = await adminGet<{ data: { votes: VoteWeightView[]; flagged: boolean } }>(
    `/ratings/game/${gameId}/votes`,
  );
  return res.data;
}

/** A short human label for a row, using the resource's labelColumn (fallback id). */
export function rowLabel(meta: ResourceMeta | undefined, row: Row): string {
  const col = meta?.labelColumn ?? 'id';
  const value = row[col];
  if (value === null || value === undefined || value === '') return String(row.id ?? '—');
  return String(value);
}
