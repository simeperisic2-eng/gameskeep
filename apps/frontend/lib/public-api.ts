/**
 * Server-side client for the GamesKeep PUBLIC API (SPEC I5a).
 *
 * The public site is API-first and server-rendered: pages fetch pre-computed,
 * leak-proof DTOs from the backend during SSR (never the DB directly, never the
 * admin token). These types mirror `apps/backend/src/public/queries.ts`.
 */
import type { InfluenceFlag, TopicFlagTally } from '@gameskeep/shared/constants';

const backendUrl = process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:4000';

export type { InfluenceFlag, TopicFlagTally } from '@gameskeep/shared/constants';

export interface TopicBiasDistribution {
  articleCount: number;
  influence: { independent: number; influenced: number; avg: number | null };
  quality: { top: number; slop: number; avg: number | null };
  computedAt: string;
}

export interface TopicCard {
  id: string;
  slug: string;
  title: string;
  tldr: string | null;
  aiSummary: string | null;
  status: string;
  typeLabel: string | null;
  articleCount: number;
  sourceCount: number;
  primaryGame: { name: string; slug: string } | null;
  distribution: TopicBiasDistribution;
  flags: TopicFlagTally;
  lastActivityAt: string | null;
}

export interface LatestArticle {
  id: string;
  title: string;
  sourceName: string | null;
  sourceSlug: string | null;
  url: string | null;
  excerpt: string | null;
  publishDate: string | null;
  origin: string;
  influence: number | null;
  quality: number | null;
  flags: InfluenceFlag[];
  reasons: string[];
}

export interface Briefing {
  stories: number;
  articles: number;
  independentPct: number | null;
  readMinutes: number;
}

export interface GenreCount {
  name: string;
  count: number;
}

export interface RankedGame {
  slug: string;
  name: string;
  our: number | null;
  critics: number | null;
  community: number | null;
  web: number | null;
  disconnectValue: number | null;
  disconnectBand: string | null;
}

export interface HomepageData {
  hero: TopicCard[];
  feed: TopicCard[];
  latest: LatestArticle[];
  topRated: RankedGame[];
  controversial: RankedGame[];
  briefing: Briefing;
  genres: GenreCount[];
}

const EMPTY_HOMEPAGE: HomepageData = {
  hero: [],
  feed: [],
  latest: [],
  topRated: [],
  controversial: [],
  briefing: { stories: 0, articles: 0, independentPct: null, readMinutes: 5 },
  genres: [],
};

/**
 * Fetch the composed homepage payload for SSR. Never throws — a backend hiccup
 * degrades to an empty (but still premium) page rather than a 500.
 */
export async function getHomepage(): Promise<HomepageData> {
  try {
    const res = await fetch(`${backendUrl}/public/homepage`, { cache: 'no-store' });
    if (!res.ok) return EMPTY_HOMEPAGE;
    const body = (await res.json()) as { data?: HomepageData };
    return body.data ?? EMPTY_HOMEPAGE;
  } catch {
    return EMPTY_HOMEPAGE;
  }
}

// ── topic / story detail (mirrors apps/backend/src/public/queries.ts) ─────────

export interface TopicArticleRow {
  id: string;
  title: string;
  excerpt: string | null;
  url: string | null;
  origin: string;
  author: string | null;
  articleType: string;
  publishDate: string | null;
  sourceName: string | null;
  sourceSlug: string | null;
  influence: number | null;
  quality: number | null;
  flags: InfluenceFlag[];
  reasons: string[];
  isPrimary: boolean;
}

export interface TopicTimelineEntry {
  occurredAt: string;
  label: string;
}

export interface RelatedTopic {
  slug: string;
  title: string;
  articleCount: number;
  sourceCount: number;
}

export interface TopicGameRating {
  slug: string;
  name: string;
  our: number | null;
  critics: number | null;
  community: number | null;
  criticsOutletCount: number | null;
  communityCount: number | null;
}

export interface TopicDetail {
  id: string;
  slug: string;
  title: string;
  tldr: string | null;
  aiSummary: string | null;
  status: string;
  typeLabel: string | null;
  publishedAt: string | null;
  lastActivityAt: string | null;
  articleCount: number;
  sourceCount: number;
  distribution: TopicBiasDistribution;
  flags: TopicFlagTally;
  games: { name: string; slug: string }[];
  primaryGame: { name: string; slug: string } | null;
  gameRating: TopicGameRating | null;
  articles: TopicArticleRow[];
  timeline: TopicTimelineEntry[];
  related: RelatedTopic[];
}

/** Fetch one story page payload for SSR. Returns null on 404/error (route 404s). */
export async function getTopic(slug: string): Promise<TopicDetail | null> {
  try {
    const res = await fetch(`${backendUrl}/public/topic/${encodeURIComponent(slug)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: TopicDetail };
    return body.data ?? null;
  } catch {
    return null;
  }
}

// ── game detail (mirrors apps/backend/src/public/queries.ts — leak-proof) ─────

export interface PublicRatingLayer {
  score: number | null;
  count: number | null;
}
export interface CriticEntry {
  outlet: string;
  score: number;
  native: string | null;
  excerpt: string | null;
  url: string | null;
}
export interface WebRatingEntry {
  label: string;
  score: number | null;
  sentimentPct: number | null;
  sampleSize: number | null;
  isEstimate: boolean;
  note: string | null;
  url: string | null;
}
export interface PublicGameRating {
  our: PublicRatingLayer;
  critics: PublicRatingLayer;
  community: PublicRatingLayer;
  web: PublicRatingLayer;
  criticEntries: CriticEntry[];
  webEntries: WebRatingEntry[];
  unusualActivity: boolean;
  disconnect: {
    value: number;
    band: string;
    contextTag: string | null;
    ourVsCritics: number | null;
    communityVsWeb: number | null;
  } | null;
}
export interface PublicContentFlags {
  aiAssets: string | null;
  launchState: string | null;
  monetization: {
    microtransactions: boolean;
    battlePass: boolean;
    lootBoxesOrGacha: boolean;
    payToWinPredatory: boolean;
  };
  hasMonetization: boolean;
  complexity: number | null;
  notes: string | null;
}
export interface PublicReview {
  verdict: string | null;
  pros: string[];
  cons: string[];
  platformTested: string | null;
  hoursPlayed: number | null;
  body: string | null;
  ourScore: number | null;
  author: string | null;
  publishedAt: string | null;
}
export interface GameArticleRow {
  id: string;
  title: string;
  excerpt: string | null;
  url: string | null;
  origin: string;
  author: string | null;
  articleType: string;
  publishDate: string | null;
  sourceName: string | null;
  sourceSlug: string | null;
  flags: InfluenceFlag[];
  reasons: string[];
}
export interface GameVideoEntry {
  provider: string;
  url: string;
  title: string | null;
  /** Channel/author (A2) — shown on the card. */
  channel: string | null;
  /** Provider thumbnail (A2). Null in demo → the designed CoverArt placeholder. */
  thumbnailUrl: string | null;
  kind: string;
  isLive: boolean;
}
export interface GamePriceEntry {
  store: string;
  platform: string | null;
  priceCents: number;
  discountPct: number;
  isOnSale: boolean;
  currency: string;
  url: string | null;
}
export interface GameSysReqEntry {
  kind: string;
  platform: string;
  os: string | null;
  cpu: string | null;
  gpu: string | null;
  ramGb: number | null;
  storageGb: number | null;
}
export interface GameDlcEntry {
  name: string;
  priceCents: number | null;
  currency: string;
  releaseDate: string | null;
  /** Outbound store page for the DLC (A2). */
  url: string | null;
}
export interface GamePlayerCount {
  current: number | null;
  peak: number | null;
  capturedAt: string;
}
export interface PlayerCountPoint {
  capturedAt: string;
  current: number | null;
}
export interface RelatedGame {
  slug: string;
  name: string;
  genres: string[];
  our: number | null;
  critics: number | null;
  community: number | null;
}
export interface GameDetail {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  description: string | null;
  status: string;
  releaseDate: string | null;
  developer: string | null;
  publisher: string | null;
  engine: string | null;
  ageRatingSystem: string | null;
  ageRatingValue: string | null;
  series: string | null;
  mode: string[];
  genres: string[];
  platforms: string[];
  tags: string[];
  coverUrl: string | null;
  backgroundUrl: string | null;
  /** Public Steam app id (A2) — outbound Steam store + SteamDB "More stats" links. */
  steamAppId: number | null;
  hltbMainHours: number | null;
  hltbCompletionistHours: number | null;
  steamCompletionRate: number | null;
  rating: PublicGameRating | null;
  contentFlags: PublicContentFlags | null;
  review: PublicReview | null;
  relatedTopics: RelatedTopic[];
  articles: GameArticleRow[];
  videos: GameVideoEntry[];
  prices: GamePriceEntry[];
  sysReqs: GameSysReqEntry[];
  dlc: GameDlcEntry[];
  playerCount: GamePlayerCount | null;
  playerCountHistory: PlayerCountPoint[];
  relatedGames: RelatedGame[];
}

/** Fetch one game hub payload for SSR. Returns null on 404/error (route 404s). */
export async function getGame(slug: string): Promise<GameDetail | null> {
  try {
    const res = await fetch(`${backendUrl}/public/game/${encodeURIComponent(slug)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: GameDetail };
    return body.data ?? null;
  } catch {
    return null;
  }
}

// ── catalog / upcoming / sources (mirror apps/backend/src/public/queries.ts) ──

export interface CatalogGame {
  slug: string;
  name: string;
  status: string;
  releaseDate: string | null;
  genres: string[];
  platforms: string[];
  coverUrl: string | null;
  our: number | null;
  critics: number | null;
  community: number | null;
  disconnectValue: number | null;
  disconnectBand: string | null;
}
export interface CatalogFacet {
  value: string;
  count: number;
}
export interface CatalogData {
  games: CatalogGame[];
  total: number;
  catalogTotal: number;
  genres: CatalogFacet[];
  platforms: CatalogFacet[];
  applied: { genre: string | null; platform: string | null; sort: string };
  /** Server-side pagination (A1): `games` is this page's slice, never the full set. */
  page: number;
  perPage: number;
  totalPages: number;
}

const EMPTY_CATALOG: CatalogData = {
  games: [],
  total: 0,
  catalogTotal: 0,
  genres: [],
  platforms: [],
  applied: { genre: null, platform: null, sort: 'rating' },
  page: 1,
  perPage: 36,
  totalPages: 1,
};

/** Fetch the (server-filtered, server-paged) catalog for SSR. Never throws — empty on failure. */
export async function getCatalog(filters: {
  genre?: string | null;
  platform?: string | null;
  sort?: string | null;
  page?: string | null;
}): Promise<CatalogData> {
  try {
    const qs = new URLSearchParams();
    if (filters.genre) qs.set('genre', filters.genre);
    if (filters.platform) qs.set('platform', filters.platform);
    if (filters.sort) qs.set('sort', filters.sort);
    if (filters.page) qs.set('page', filters.page);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const res = await fetch(`${backendUrl}/public/catalog${suffix}`, { cache: 'no-store' });
    if (!res.ok) return EMPTY_CATALOG;
    const body = (await res.json()) as { data?: CatalogData };
    return body.data ?? EMPTY_CATALOG;
  } catch {
    return EMPTY_CATALOG;
  }
}

// ── discovery (A1) — the curated /games entry ────────────────────────────────

export interface MostDiscussedGame extends CatalogGame {
  articleCount: number;
  sourceCount: number;
}
export interface DiscoveryData {
  catalogTotal: number;
  topRated: CatalogGame[];
  mostDiscussed: MostDiscussedGame[];
  genres: CatalogFacet[];
  comingSoon: UpcomingGame[];
}

const EMPTY_DISCOVERY: DiscoveryData = {
  catalogTotal: 0,
  topRated: [],
  mostDiscussed: [],
  genres: [],
  comingSoon: [],
};

/** Fetch the /games discovery composition for SSR. Never throws — empty on failure. */
export async function getDiscovery(): Promise<DiscoveryData> {
  try {
    const res = await fetch(`${backendUrl}/public/discovery`, { cache: 'no-store' });
    if (!res.ok) return EMPTY_DISCOVERY;
    const body = (await res.json()) as { data?: DiscoveryData };
    return body.data ?? EMPTY_DISCOVERY;
  } catch {
    return EMPTY_DISCOVERY;
  }
}

export interface UpcomingGame {
  id: string;
  slug: string;
  name: string;
  status: string;
  releaseDate: string | null;
  genres: string[];
  platforms: string[];
  developer: string | null;
  publisher: string | null;
  series: string | null;
  summary: string | null;
  coverUrl: string | null;
}

/** Fetch the upcoming slate for SSR. Never throws — empty list on failure. */
export async function getUpcoming(): Promise<UpcomingGame[]> {
  try {
    const res = await fetch(`${backendUrl}/public/upcoming`, { cache: 'no-store' });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: UpcomingGame[] };
    return body.data ?? [];
  } catch {
    return [];
  }
}

export interface SourceCard {
  slug: string;
  name: string;
  typeLabel: string | null;
  parentCompany: string | null;
  articleCount: number;
  affiliatePct: number | null;
  reputation: number | null;
  ownerSiblingCount: number;
}
export interface SourcesData {
  sources: SourceCard[];
  owners: { name: string; outlets: number }[];
  articleTotal: number;
}

const EMPTY_SOURCES: SourcesData = { sources: [], owners: [], articleTotal: 0 };

/** Fetch the sources index for SSR. Never throws — empty on failure. */
export async function getSources(): Promise<SourcesData> {
  try {
    const res = await fetch(`${backendUrl}/public/sources`, { cache: 'no-store' });
    if (!res.ok) return EMPTY_SOURCES;
    const body = (await res.json()) as { data?: SourcesData };
    return body.data ?? EMPTY_SOURCES;
  } catch {
    return EMPTY_SOURCES;
  }
}

export interface SourceDetail {
  slug: string;
  name: string;
  typeLabel: string | null;
  parentCompany: string | null;
  websiteUrl: string | null;
  description: string | null;
  articleCount: number;
  affiliatePct: number | null;
  reputation: number | null;
  flags: TopicFlagTally;
  owner: { name: string; siblings: { slug: string; name: string }[] } | null;
  recentArticles: GameArticleRow[];
  topGames: { slug: string; name: string; count: number }[];
}

/** Fetch one outlet profile for SSR. Returns null on 404/error (route 404s). */
export async function getSource(slug: string): Promise<SourceDetail | null> {
  try {
    const res = await fetch(`${backendUrl}/public/source/${encodeURIComponent(slug)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: SourceDetail };
    return body.data ?? null;
  } catch {
    return null;
  }
}

export interface SitemapTopic {
  slug: string;
  lastModified: string | null;
}

/** Topic + game + source slugs + lastmod for sitemap.xml. Never throws. */
async function getSitemap(): Promise<{
  topics: SitemapTopic[];
  games: SitemapTopic[];
  sources: SitemapTopic[];
}> {
  try {
    const res = await fetch(`${backendUrl}/public/sitemap`, { cache: 'no-store' });
    if (!res.ok) return { topics: [], games: [], sources: [] };
    const body = (await res.json()) as {
      data?: { topics?: SitemapTopic[]; games?: SitemapTopic[]; sources?: SitemapTopic[] };
    };
    return {
      topics: body.data?.topics ?? [],
      games: body.data?.games ?? [],
      sources: body.data?.sources ?? [],
    };
  } catch {
    return { topics: [], games: [], sources: [] };
  }
}

// ── community comments (I6 Slice 8 — public read, SSR'd for escaping) ─────────
export interface PublicComment {
  id: string;
  parentId: string | null;
  body: string;
  username: string;
  createdAt: string;
}

/** SSR-fetch a target's comments (public). React escapes each body on render. */
export async function getComments(
  entityType: 'game' | 'topic' | 'article',
  entityId: string,
): Promise<PublicComment[]> {
  try {
    const res = await fetch(`${backendUrl}/community/comment/${entityType}/${entityId}`, {
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: PublicComment[] };
    return body.data ?? [];
  } catch {
    return [];
  }
}

// ── public user profile (I6 Slice 8) ────────────────────────────────────────
export interface PublicProfile {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: string;
  level: { key: string; label: string } | null;
  badges: { key: string; label: string; iconUrl: string | null }[];
  joinedAt: string;
  ratingCount: number;
  commentCount: number;
}

/** Fetch a public profile for SSR. Returns null on 404/error (route 404s). */
export async function getPublicProfile(username: string): Promise<PublicProfile | null> {
  try {
    const res = await fetch(`${backendUrl}/public/user/${encodeURIComponent(username)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: PublicProfile };
    return body.data ?? null;
  } catch {
    return null;
  }
}

export async function getSitemapTopics(): Promise<SitemapTopic[]> {
  return (await getSitemap()).topics;
}

export async function getSitemapGames(): Promise<SitemapTopic[]> {
  return (await getSitemap()).games;
}

export async function getSitemapSources(): Promise<SitemapTopic[]> {
  return (await getSitemap()).sources;
}
