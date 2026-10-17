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
  /**
   * Phase P S3b: third-party data (shown as received). Editing these fields, or
   * deleting the row, needs an import-error reason (`conditional`: only for rows
   * that came from an import).
   */
  thirdParty?: {
    fields: string[] | 'all';
    conditional: boolean;
    reasons: { value: string; label: string }[];
  } | null;
  /** Phase P S3b: a staff edit of these fields locks them against the engines. */
  fieldLocks?: { column: string; fields: readonly string[] } | null;
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

// ── ads / promotions (I8 Slice 2) ─────────────────────────────────────────────
export interface AdInventoryRow {
  slotKey: string;
  label: string;
  page: string;
  format: string;
  fallback: string;
  state: 'active' | 'scheduled' | 'free';
  placement: {
    advertiser: string;
    status: string;
    startsAt: string | null;
    endsAt: string | null;
  } | null;
}
export interface AdSlotAnalytics {
  slotKey: string;
  label: string;
  impressions: number;
  clicks: number;
  ctr: number;
  placements: number;
  occupied: boolean;
}
export interface AdAnalytics {
  slots: AdSlotAnalytics[];
  totals: { slots: number; free: number; impressions: number; clicks: number };
}

export async function getAdInventory(): Promise<AdInventoryRow[]> {
  return (await adminGet<{ data: AdInventoryRow[] }>('/ads/inventory')).data;
}
export async function getAdAnalytics(): Promise<AdAnalytics> {
  return (await adminGet<{ data: AdAnalytics }>('/ads/analytics')).data;
}

// ── newsletter (I8 Slice 3) ───────────────────────────────────────────────────
export interface NewsletterCampaignRow {
  id: string;
  subject: string;
  segment: string;
  kind: string;
  status: string;
  recipientCount: number;
  opens: number;
  clicks: number;
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string | null;
}
export interface NewsletterOverview {
  subscribers: { total: number; active: number; unsubscribed: number };
  segments: { segment: string; active: number }[];
  growth: { weekEnding: string; activeSubscribers: number }[];
  campaigns: NewsletterCampaignRow[];
}
export interface SubscriberRow {
  id: string;
  email: string;
  source: string;
  active: boolean;
  registered: boolean;
  createdAt: string | null;
  unsubscribedAt: string | null;
}

export async function getNewsletterOverview(): Promise<NewsletterOverview> {
  return (await adminGet<{ data: NewsletterOverview }>('/newsletter/overview')).data;
}
export async function getSubscribers(q?: string): Promise<SubscriberRow[]> {
  const qs = q ? `?q=${encodeURIComponent(q)}` : '';
  return (await adminGet<{ data: SubscriberRow[] }>(`/newsletter/subscribers${qs}`)).data;
}

// ── lists / slot configuration (I8 Slice 4) ───────────────────────────────────
/** The `lists` setting — only the "New" window since Phase P S2. */
export interface ListsConfig {
  newWindowDays: number;
}
/** What the homepage sections currently show (the stored snapshots, hydrated). */
export interface HomepagePreview {
  computedAt: string | null;
  sections: {
    key: string;
    title: string;
    windowHours: number | null;
    items: {
      label: string;
      pinned: boolean;
      promoted: string | null;
      delta: string | null;
    }[];
  }[];
}
export interface SlotPlacementRow {
  slotKey: string;
  label: string;
  page: string;
  format: string;
  fallback: string;
  state: 'active' | 'scheduled' | 'free';
  placement: {
    advertiser: string;
    status: string;
    startsAt: string | null;
    endsAt: string | null;
  } | null;
}

export async function getListsConfig(): Promise<{ config: ListsConfig }> {
  return (await adminGet<{ data: { config: ListsConfig } }>('/lists/config')).data;
}
export async function getHomepagePreview(): Promise<HomepagePreview> {
  return (await adminGet<{ data: HomepagePreview }>('/lists/preview')).data;
}

// ── Phase P S3: tags ──────────────────────────────────────────────────────────
export interface TagQueueRow {
  id: string;
  game: { slug: string; name: string };
  tag: { slug: string; name: string; family: 'content' | 'issue' };
  state: 'pending' | 'published' | 'rejected';
  source: 'import' | 'players' | 'editors';
  weightedScore: number;
  voteCount: number;
  thresholdReached: boolean;
  flagged: boolean;
  flagInfo: { windowCount?: number; lowShare?: number; historicalRate?: number } | null;
  firstSeenAt: string;
  lastVoteAt: string | null;
  lastConfirmedAt: string | null;
  confirmedBy: string | null;
  resolvedAt: string | null;
  patchRef: string | null;
  issueStatus: 'active' | 'past' | 'resolved' | null;
}
export interface TagSuggestionRow {
  id: string;
  rawName: string;
  normalized: string;
  source: 'import' | 'user';
  game: { slug: string; name: string } | null;
  attempts: number;
  createdAt: string;
}
export interface TagQueue {
  threshold: number;
  pending: TagQueueRow[];
  published: TagQueueRow[];
  /** Phase P S3b: tags an editor removed that readers keep voting for. */
  pushback?: (TagQueueRow & { removedAt: string | null; votesSinceRemoval: number })[];
  suggestions: TagSuggestionRow[];
}
export interface TagSettingsConfig {
  publishThreshold: number;
  minCredibility: number;
  issueExpiryDays: number;
  indexMinGames: number;
  showAnomalyLabel: boolean;
  catalogCardCount: number;
  burstWindowHours: number;
  burstMinVotes: number;
  burstMultiplier: number;
  lowCredibilityShare: number;
  quickViewCacheSeconds: number;
}
export async function getTagQueue(): Promise<TagQueue> {
  return (await adminGet<{ data: TagQueue }>('/tag-queue')).data;
}
/** Admin-only (ADMIN 40): null for a moderator. */
export async function getTagSettings(): Promise<TagSettingsConfig | null> {
  try {
    return (await adminGet<{ data: TagSettingsConfig }>('/tag-settings')).data;
  } catch {
    return null;
  }
}

// ── S2 review: the public suggest form's rate limits ─────────────────────────
export interface SuggestLimits {
  perIpMax: number;
  globalMax: number;
  windowMinutes: number;
}
export async function getSuggestLimits(): Promise<SuggestLimits> {
  return (await adminGet<{ data: SuggestLimits }>('/catalog/suggest-settings')).data;
}

// ── Phase P S2: homepage sections ─────────────────────────────────────────────
export type HomepageRuleDimension = 'categories' | 'tags' | 'genres' | 'sources';
export type HomepageRuleLists = Partial<Record<HomepageRuleDimension, string[]>>;
export interface HomepageSectionConfig {
  id: string;
  key: string;
  kind: 'data' | 'discovery' | 'block';
  items: 'topic' | 'game' | 'mixed' | 'none';
  delta: boolean;
  title: string;
  defaultTitle: string;
  enabled: boolean;
  position: number;
  mode: 'auto' | 'manual' | 'pins_auto';
  itemCount: number;
  deltaWindowHours: number | null;
  /** Phase P S3b: show the Δ chip on this section's cards. */
  showDelta: boolean;
  /** Phase P S3b: slugs whose Δ chip is hidden. */
  hideDeltaRefs: string[];
  cardTagFamilies: string[];
  cardTagCount: number;
  rules: { include: HomepageRuleLists; exclude: HomepageRuleLists };
  ruleDimensions: HomepageRuleDimension[];
  /** Positions of paid items, ascending (owner decision B: any list section). */
  paidPositions: number[];
  /** Below this many qualifying items the section is hidden (null = never). */
  minItems: number | null;
  pins: {
    position: number;
    topicSlug: string | null;
    gameSlug: string | null;
    name: string | null;
  }[];
  promotions: {
    id: string;
    advertiser: string;
    gameSlug: string | null;
    gameName: string | null;
    topicSlug: string | null;
    topicTitle: string | null;
    /** Set on create when the item already ranks organically in the section. */
    warning?: string | null;
    status: string;
    startsAt: string | null;
    endsAt: string | null;
  }[];
}
export interface HomepageSettingsConfig {
  deltaMinPoints: number;
  trendingWeights: { articles: number; sources: number; comments: number; follows: number };
  perUserCap: number;
  minCredibility: number;
  maxEngagementShare: number;
  refreshMinutes: number;
  showUnsoldPlaceholder: boolean;
  steamSampleEveryHours: number;
}
export interface HomepageConfig {
  sections: HomepageSectionConfig[];
  settings: HomepageSettingsConfig;
  lastComputedAt: string | null;
}
export async function getHomepageConfig(): Promise<HomepageConfig> {
  return (await adminGet<{ data: HomepageConfig }>('/homepage/config')).data;
}
export async function getListsSlots(): Promise<SlotPlacementRow[]> {
  return (await adminGet<{ data: SlotPlacementRow[] }>('/lists/slots')).data;
}

// ── Phase P S1: display switches + review integrity ──────────────────────────
export interface IntegrityLexicon {
  reviewCopy: string[];
  embargo: string[];
  sponsoredEvent: string[];
  negations: string[];
}
export interface DisplayConfig {
  displayScope: 'reviews_and_sponsored' | 'all';
  showQuality: boolean;
  topicBiasVotes: boolean;
  briefingWindowHours: number;
  integrityAutoPublish: boolean;
  integrityLexicon: IntegrityLexicon;
}
export async function getDisplayConfig(): Promise<DisplayConfig> {
  return (await adminGet<{ data: DisplayConfig }>('/display/config')).data;
}

export interface IntegritySignalRow {
  id: string;
  kind: 'review_copy' | 'embargo' | 'sponsored_event';
  origin: 'auto' | 'editor';
  status: 'detected' | 'confirmed' | 'dismissed';
  evidenceSnippet: string | null;
  editorNote: string | null;
  evidenceDate: string | null;
  decidedByLabel: string | null;
  decidedAt: string | null;
}
export interface IntegrityReviewRow {
  articleId: string;
  title: string;
  sourceName: string | null;
  url: string | null;
  publishDate: string | null;
  signals: IntegritySignalRow[];
}
export async function getIntegrityReviews(): Promise<{
  reviews: IntegrityReviewRow[];
  autoPublish: boolean;
}> {
  return (
    await adminGet<{ data: { reviews: IntegrityReviewRow[]; autoPublish: boolean } }>(
      '/integrity/reviews',
    )
  ).data;
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
    /** Phase P S3b: an editor's band override (null = computed) + its reason. */
    bandOverride?: string | null;
    bandOverrideReason?: string | null;
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

// ── Phase P S3b: rules & limits, briefing override, copy registry ────────────
export type RuleLeaf = boolean | number | number[];
export interface RuleTree {
  [k: string]: RuleLeaf | RuleTree;
}
export interface RulesConfig {
  settings: RuleTree;
  defaults: RuleTree;
  bounds: Record<string, [number, number]>;
}
export async function getRulesConfig(): Promise<RulesConfig> {
  return (await adminGet<{ data: RulesConfig }>('/rules')).data;
}

export interface BriefingOverrideConfig {
  date: string | null;
  text: string | null;
  hidden: boolean;
}
export async function getBriefingOverride(): Promise<BriefingOverrideConfig> {
  return (await adminGet<{ data: BriefingOverrideConfig }>('/rules/briefing')).data;
}

export interface CopyDefView {
  key: string;
  group: string;
  label: string;
  kind: 'text' | 'longtext' | 'rich' | 'doc' | 'email' | 'domain' | 'brand';
  default: string;
  max: number;
  locked?: boolean;
  ownerOnly?: boolean;
  required?: boolean;
}
export interface CopyConfig {
  groups: { key: string; label: string }[];
  defs: CopyDefView[];
  stored: Record<string, string>;
  values: Record<string, string>;
  tokens: string[];
  lockedPages: { label: string; path: string; note: string }[];
  canEditIdentity: boolean;
}
export async function getCopyConfig(): Promise<CopyConfig> {
  return (await adminGet<{ data: CopyConfig }>('/copy')).data;
}

// ── Phase P S4: editorial lists, news categories, search ─────────────────────
export interface AdminListRow {
  id: string;
  status: 'candidate' | 'confirmed' | 'rejected';
  outletName: string;
  title: string;
  url: string | null;
  year: number | null;
  categoryKey: string | null;
  publishedAt: string | null;
  detectedBy: string;
  decidedBy: string | null;
  entries: number;
  matched: number;
}
export interface ListsQueueData {
  candidates: AdminListRow[];
  confirmed: AdminListRow[];
  rejected: AdminListRow[];
  categories: { key: string; label: string; sort: number; active: boolean }[];
  pairs: { year: number; categoryKey: string; label: string; lists: number; isPublic: boolean }[];
}
export async function getListsQueueData(): Promise<ListsQueueData> {
  return (await adminGet<{ data: ListsQueueData }>('/editorial-lists/queue')).data;
}
export async function getListLexicon(): Promise<{ patterns: string[]; gotyPatterns: string[] }> {
  return (
    await adminGet<{ data: { patterns: string[]; gotyPatterns: string[] } }>(
      '/editorial-lists/lexicon',
    )
  ).data;
}

export interface NewsCategoryOverview {
  id: string;
  key: string;
  label: string;
  mode: 'show' | 'low' | 'hide';
  keywords: string[];
  priority: number;
  active: boolean;
  articles: number;
  stories: number;
}
export async function getNewsOverview(): Promise<NewsCategoryOverview[]> {
  return (await adminGet<{ data: NewsCategoryOverview[] }>('/news/overview')).data;
}

// ── Phase P S5: community voice, critic feed, story summaries, community knobs ─
export interface AdminNoteSource {
  url: string;
  label?: string;
}
export interface AdminCommunityNote {
  game: { id: string; slug: string; name: string };
  status: 'draft' | 'published';
  text: string;
  sources: AdminNoteSource[];
  asOf: string | null;
  editor: string | null;
  publishedAt: string | null;
  published: { text: string; sources: AdminNoteSource[]; asOf: string | null } | null;
  polish: {
    original: string;
    candidate: string;
    ok: boolean;
    issues: { kind: string; token: string }[];
    provider: string | null;
    at: string | null;
    diff: { op: 'same' | 'add' | 'del'; text: string }[];
  } | null;
}
export interface AdminSteamSummary {
  slug: string;
  name: string;
  reviewCount: number;
  positivePct: number | null;
  windowDays: number;
  summaryText: string | null;
  editedText: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  hidden: boolean;
  computedAt: string | null;
  publicState: 'shown-ai' | 'shown-editorial' | 'below-threshold' | 'hidden' | 'no-text';
}
export interface CommunityVoiceData {
  notes: { slug: string; name: string; status: string; updatedAt: string; editor: string | null }[];
  steam: AdminSteamSummary[];
}
export async function getCommunityVoiceData(): Promise<CommunityVoiceData> {
  return (await adminGet<{ data: CommunityVoiceData }>('/community-voice')).data;
}

export interface CriticFeedItem {
  guid: string;
  title: string;
  excerpt: string | null;
  url: string | null;
  reviewDate: string | null;
  outlet: { name: string; slug: string | null };
  game: { slug: string; name: string };
  suggestion: { nativeScore: number; scaleMax: number; normalized: number; match: string } | null;
}
export interface CriticFeedData {
  queue: CriticFeedItem[];
  dismissed: { guid: string; note: string | null; decidedBy: string | null; decidedAt: string }[];
  provider: { provider: string; live: boolean; description: string };
}
export async function getCriticFeedData(): Promise<CriticFeedData> {
  return (await adminGet<{ data: CriticFeedData }>('/critic-feed')).data;
}

export interface StorySummaryRow {
  id: string;
  slug: string;
  title: string;
  tldr: string | null;
  aiSummary: string | null;
  tldrIsAi: boolean;
  summaryIsAi: boolean;
  tldrApprovedBy: string | null;
  summaryApprovedBy: string | null;
  approvedAt: string | null;
  locked: string[];
}
export async function getStorySummaries(
  filter: 'ai' | 'editorial' | 'all' = 'ai',
): Promise<StorySummaryRow[]> {
  return (await adminGet<{ data: StorySummaryRow[] }>(`/story-summaries?filter=${filter}`)).data;
}

export interface CommunityKnobs {
  writesPerUser: number;
  writeWindowSec: number;
  autoHideReports: number;
}
export interface ReputationKnobs {
  helpfulWeight: number;
  reportWeight: number;
  tenureWeightPerDay: number;
  tenureCapDays: number;
  removedPenalty: number;
  positiveReactions: string[];
  earlyVoterVotes: number;
  levelThresholds: { contributor: number; trusted: number; veteran: number; legend: number };
}
export async function getCommunityKnobs(): Promise<{
  values: CommunityKnobs;
  defaults: CommunityKnobs;
}> {
  return (
    await adminGet<{ data: { values: CommunityKnobs; defaults: CommunityKnobs } }>(
      '/community-settings',
    )
  ).data;
}
export async function getReputationKnobs(): Promise<{
  values: ReputationKnobs;
  defaults: ReputationKnobs;
}> {
  return (
    await adminGet<{ data: { values: ReputationKnobs; defaults: ReputationKnobs } }>(
      '/reputation-settings',
    )
  ).data;
}
