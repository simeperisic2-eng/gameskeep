/**
 * Server-side client for the GamesKeep PUBLIC API (SPEC I5a).
 *
 * The public site is API-first and server-rendered: pages fetch pre-computed,
 * leak-proof DTOs from the backend during SSR (never the DB directly, never the
 * admin token). These types mirror `apps/backend/src/public/queries.ts`.
 */
import type {
  BiasDisplayScope,
  InfluenceFlag,
  IntegritySignalKind,
  TopicFlagTally,
} from '@gameskeep/shared/constants';

const backendUrl = process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:4000';

export type { InfluenceFlag, TopicFlagTally } from '@gameskeep/shared/constants';

/** The public display switches every page payload carries (Phase P S1). */
export interface PublicDisplay {
  scope: BiasDisplayScope;
  showQuality: boolean;
  topicBiasVotes: boolean;
}

export const DEFAULT_DISPLAY: PublicDisplay = {
  scope: 'reviews_and_sponsored',
  showQuality: false,
  topicBiasVotes: false,
};

/** Public review-integrity rows beyond review copy (counted per article). */
export interface IntegrityTally {
  embargo: number;
  sponsoredEvent: number;
}

/** How a row shows its signals — decided server-side (display scope). */
export type BiasMode = 'panel' | 'chip' | 'none';

/** Public topic distribution: the quality split only while it is shown. */
export interface TopicBiasDistribution {
  articleCount: number;
  quality: { top: number; slop: number; avg: number | null } | null;
}

/** One public review-integrity row (Phase P S1) — always with its evidence. */
export interface PublicIntegrityRow {
  kind: IntegritySignalKind;
  label: string;
  evidenceType: 'snippet' | 'note';
  evidence: string;
  date: string | null;
  confirmed: boolean;
}

export interface TopicCard {
  id: string;
  slug: string;
  title: string;
  tldr: string | null;
  aiSummary: string | null;
  /** Phase P S5: automatic AI text → render the locked AI label with it (false = editorial). */
  tldrIsAi?: boolean;
  summaryIsAi?: boolean;
  status: string;
  typeLabel: string | null;
  articleCount: number;
  sourceCount: number;
  reviewCount: number;
  showPanel: boolean;
  primaryGame: { name: string; slug: string } | null;
  distribution: TopicBiasDistribution;
  flags: TopicFlagTally;
  integrityTally: IntegrityTally;
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
  articleType: string;
  biasMode: BiasMode;
  flags: InfluenceFlag[];
  reasons: string[];
}

/** Counts only (never a percentage); `isToday` false ⇒ window ends at `asOf`. */
export interface Briefing {
  isToday: boolean;
  asOf: string | null;
  windowHours: number;
  sources: number;
  topics: number;
  reviews: number;
  /** Phase P S3b: an editor's line for today, shown instead of the counts. */
  overrideText?: string | null;
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

/** Δ vs the previous window of equal length ("New" / "—" are honest states). */
export type Delta = { kind: 'pct'; value: number } | { kind: 'new' } | { kind: 'none' };

/** A game as a homepage section card (identity + the two public score layers). */
export interface HomepageGameCard {
  slug: string;
  name: string;
  coverUrl: string | null;
  status: string;
  releaseDate: string | null;
  genres: string[];
  critics: number | null;
  community: number | null;
}

/** One outlet's headline on a Trending story (links OUT to the original). */
export interface HomepageCoverageRow {
  source: string;
  title: string;
  url: string | null;
}

/** Who paid for an item and what it is (the label: game → Promoted, story → Sponsored). */
export interface PaidInfo {
  advertiser: string;
  kind: 'game' | 'story';
}

export interface HomepageSectionItem {
  type: 'topic' | 'game';
  /** An editorial pin — never paid, never labeled. */
  pinned: boolean;
  /**
   * A PAID insert (any section — owner decision). The label is render-forced and
   * always "Promoted" (game or story — "Sponsored" is the outlet's own signal).
   * Organic entries: null.
   */
  paid: PaidInfo | null;
  delta: Delta | null;
  metric: number | null;
  topic: TopicCard | null;
  game: HomepageGameCard | null;
  /** Phase P S3: the section's configured tag families + count. */
  tags: CardTag[];
  coverage: HomepageCoverageRow[] | null;
}

/** One enabled homepage section, in the admin's page order. */
export interface HomepageSection {
  key: string;
  kind: 'data' | 'discovery' | 'block' | string;
  title: string;
  windowHours: number | null;
  items: HomepageSectionItem[];
}

export interface HomepageData {
  /** Phase P S2: the admin-configured sections, in page order (enabled only). */
  sections: HomepageSection[];
  computedAt: string | null;
  hero: TopicCard[];
  feed: TopicCard[];
  latest: LatestArticle[];
  topRated: RankedGame[];
  controversial: RankedGame[];
  briefing: Briefing;
  genres: GenreCount[];
  display: PublicDisplay;
}

const EMPTY_HOMEPAGE: HomepageData = {
  sections: [],
  computedAt: null,
  hero: [],
  feed: [],
  latest: [],
  topRated: [],
  controversial: [],
  briefing: { isToday: true, asOf: null, windowHours: 24, sources: 0, topics: 0, reviews: 0 },
  genres: [],
  display: DEFAULT_DISPLAY,
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
  /** Null while the quality axis is hidden. */
  quality: number | null;
  isReview: boolean;
  biasMode: BiasMode;
  flags: InfluenceFlag[];
  reasons: string[];
  /** Review rows only (empty ⇒ "No signals found"). */
  integrity: PublicIntegrityRow[] | null;
  /** Phase P S4: the category label of a "low" / "hide" item (a chip); else null. */
  category?: string | null;
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
  /** Phase P S3b: an editor kept this page out of search (noindex,follow). */
  noindex?: boolean;
  id: string;
  slug: string;
  title: string;
  tldr: string | null;
  aiSummary: string | null;
  /** Phase P S5: automatic AI text → render the locked AI label with it (false = editorial). */
  tldrIsAi?: boolean;
  summaryIsAi?: boolean;
  status: string;
  typeLabel: string | null;
  publishedAt: string | null;
  lastActivityAt: string | null;
  articleCount: number;
  sourceCount: number;
  reviewCount: number;
  showPanel: boolean;
  distribution: TopicBiasDistribution;
  flags: TopicFlagTally;
  integrityTally: IntegrityTally;
  games: { name: string; slug: string }[];
  primaryGame: { name: string; slug: string } | null;
  gameRating: TopicGameRating | null;
  articles: TopicArticleRow[];
  timeline: TopicTimelineEntry[];
  related: RelatedTopic[];
  display: PublicDisplay;
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
  /** Phase P S5: null while the team score is switched off. */
  our: PublicRatingLayer | null;
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
export type GameArticleRow = TopicArticleRow;
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
  /** Phase P S3b: an editor kept this page out of search (noindex,follow). */
  noindex?: boolean;
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
  /** Published tags, grouped Content / Issues (Phase P S3). */
  tagGroups: GameTagGroups;
  review: PublicReview | null;
  relatedTopics: RelatedTopic[];
  /** Phase P S4: positions on confirmed editorial lists + comparison lines. */
  editorialLists?: GameEditorialLists;
  /** Phase P S5: the editor note "What the community says" (editorial — no AI label). */
  communityNote?: {
    text: string;
    sources: { url: string; label?: string }[];
    asOf: string | null;
    editor: string | null;
  } | null;
  /** Phase P S5: the Steam reviews summary (shown from the admin threshold). */
  steamReviews?: {
    reviewCount: number;
    positivePct: number | null;
    windowDays: number;
    text: string;
    isAi: boolean;
    storeUrl: string | null;
  } | null;
  /** Outlet review articles — own block, pinned above the news (Phase P S1). */
  reviews: GameArticleRow[];
  /** Other coverage (reviews excluded). */
  articles: GameArticleRow[];
  display: PublicDisplay;
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

// ── Phase P S3: tags ───────────────────────────────────────────────────────────
export type TagFamily = 'content' | 'issue';
/** A tag on a card (the section / catalog decides which and how many). */
export interface CardTag {
  family: TagFamily;
  slug: string;
  name: string;
}
export interface PublicTag {
  slug: string;
  name: string;
  family: TagFamily;
  /** "Unusual voting activity" — only when the admin switch is on (default off). */
  unusual: boolean;
}
export interface PublicIssueTag extends PublicTag {
  status: 'active' | 'past' | 'resolved';
  /** Truthful provenance — issue tags only ("Added by editors" / "Reported by players · …"). */
  provenance: string | null;
  firstSeen: string;
  lastConfirmed: string | null;
  resolvedAt: string | null;
  patchRef: string | null;
  pastUntil: string | null;
}
export interface GameTagGroups {
  content: PublicTag[];
  issues: PublicIssueTag[];
}
export interface TagFacet {
  slug: string;
  name: string;
  family: TagFamily;
  count: number;
}

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
  tags: CardTag[];
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
  tagFacets: TagFacet[];
  applied: {
    genre: string | null;
    platform: string | null;
    sort: string;
    tags: string[];
    xtags: string[];
  };
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
  tagFacets: [],
  applied: { genre: null, platform: null, sort: 'rating', tags: [], xtags: [] },
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
  tags?: string[];
  xtags?: string[];
}): Promise<CatalogData> {
  try {
    const qs = new URLSearchParams();
    if (filters.genre) qs.set('genre', filters.genre);
    if (filters.platform) qs.set('platform', filters.platform);
    if (filters.sort) qs.set('sort', filters.sort);
    if (filters.page) qs.set('page', filters.page);
    for (const t of filters.tags ?? []) qs.append('tag', t);
    for (const t of filters.xtags ?? []) qs.append('xtag', t);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const res = await fetch(`${backendUrl}/public/catalog${suffix}`, { cache: 'no-store' });
    if (!res.ok) return EMPTY_CATALOG;
    const body = (await res.json()) as { data?: CatalogData };
    return body.data ?? EMPTY_CATALOG;
  } catch {
    return EMPTY_CATALOG;
  }
}

// ── tag pages + quick view (Phase P S3) ───────────────────────────────────────
export interface TagPageData {
  tag: { slug: string; name: string; family: TagFamily; intro: string | null };
  games: CatalogGame[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  indexable: boolean;
  indexMinGames: number;
}
/** A tag page; null = unknown / retired tag (→ 404). Never throws. */
export async function getTagPage(slug: string, page: string | null): Promise<TagPageData | null> {
  try {
    const qs = page ? `?page=${encodeURIComponent(page)}` : '';
    const res = await fetch(`${backendUrl}/public/tag/${encodeURIComponent(slug)}${qs}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: TagPageData };
    return body.data ?? null;
  } catch {
    return null;
  }
}
export interface QuickViewData {
  slug: string;
  name: string;
  coverUrl: string | null;
  layers: { critics: number | null; our: number | null; community: number | null };
  disconnect: { value: number | null; band: string | null };
  tags: { content: CardTag[]; issues: CardTag[] };
  players: {
    current: number | null;
    capturedAt: string;
    delta: Delta | null;
    windowHours: number;
  } | null;
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

/** An Upcoming/New entry — a game + its enrichment flags (indie/featured/promoted). */
export interface UpcomingEntry extends UpcomingGame {
  isIndie: boolean;
  /** Editorial curatorial pin — UNLABELED (our opinion, not paid). */
  featured: boolean;
  /** PAID promotion — carries the render-forced "Promoted" label. */
  promoted: { advertiser: string } | null;
}

export interface UpcomingDlcEntry {
  id: string;
  name: string;
  parentSlug: string;
  parentName: string;
  releaseDate: string | null;
  priceCents: number | null;
  currency: string;
  url: string | null;
}

export interface UpcomingPageData {
  games: UpcomingEntry[];
  dlc: UpcomingDlcEntry[];
  newReleases: UpcomingEntry[];
  genres: string[];
  platforms: string[];
  newWindowDays: number;
  filters: { genre: string | null; platform: string | null; indie: boolean };
}

const EMPTY_UPCOMING: UpcomingPageData = {
  games: [],
  dlc: [],
  newReleases: [],
  genres: [],
  platforms: [],
  newWindowDays: 30,
  filters: { genre: null, platform: null, indie: false },
};

/** Fetch the grouped Upcoming page for SSR. Never throws — empty groups on failure. */
export async function getUpcoming(
  filters: {
    genre?: string;
    platform?: string;
    indie?: boolean;
  } = {},
): Promise<UpcomingPageData> {
  const qs = new URLSearchParams();
  if (filters.genre) qs.set('genre', filters.genre);
  if (filters.platform) qs.set('platform', filters.platform);
  if (filters.indie) qs.set('indie', '1');
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  try {
    const res = await fetch(`${backendUrl}/public/upcoming${suffix}`, { cache: 'no-store' });
    if (!res.ok) return EMPTY_UPCOMING;
    const body = (await res.json()) as { data?: UpcomingPageData };
    return body.data ?? EMPTY_UPCOMING;
  } catch {
    return EMPTY_UPCOMING;
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
  /** Null while the quality axis is hidden. */
  reputation: number | null;
  flags: TopicFlagTally;
  integrityTally: IntegrityTally;
  display: PublicDisplay;
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
  tags: SitemapTopic[];
  lists: SitemapListPage[];
}> {
  const empty = { topics: [], games: [], sources: [], tags: [], lists: [] };
  try {
    const res = await fetch(`${backendUrl}/public/sitemap`, { cache: 'no-store' });
    if (!res.ok) return empty;
    const body = (await res.json()) as {
      data?: {
        topics?: SitemapTopic[];
        games?: SitemapTopic[];
        sources?: SitemapTopic[];
        tags?: SitemapTopic[];
        lists?: SitemapListPage[];
      };
    };
    return {
      topics: body.data?.topics ?? [],
      games: body.data?.games ?? [],
      sources: body.data?.sources ?? [],
      tags: body.data?.tags ?? [],
      lists: body.data?.lists ?? [],
    };
  } catch {
    return empty;
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

/** The public display switches (Phase P S1). Never throws — the hidden defaults on error. */
export async function getDisplay(): Promise<PublicDisplay> {
  try {
    const res = await fetch(`${backendUrl}/public/display`, { cache: 'no-store' });
    if (!res.ok) return DEFAULT_DISPLAY;
    const body = (await res.json()) as { data?: PublicDisplay };
    return body.data ?? DEFAULT_DISPLAY;
  } catch {
    return DEFAULT_DISPLAY;
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

/** Phase P S4: public editorial-list consensus pages (≥ the admin-set minimum of lists). */
export async function getSitemapLists(): Promise<SitemapListPage[]> {
  return (await getSitemap()).lists;
}

/** Indexable tag pages only (≥ the admin-set minimum of published games). */
export async function getSitemapTags(): Promise<SitemapTopic[]> {
  return (await getSitemap()).tags;
}

// ── awards (I7) ──────────────────────────────────────────────────────────────
export interface AwardEdition {
  year: number;
  name: string;
  phase: string;
  isPublished: boolean;
  description: string | null;
  votingOpensAt: string | null;
  votingClosesAt: string | null;
  comingSoon: boolean;
}
export interface AwardNominee {
  nominationId: string;
  name: string;
  slug: string;
  blurb: string | null;
  scores: { our: number | null; critics: number | null; community: number | null } | null;
  disconnect: { value: number; band: string | null } | null;
  votes: number;
  weightSum: number;
  ratio: number;
  isCommunityWinner: boolean;
  isCriticsWinner: boolean;
}
export interface AwardCategory {
  editionCategoryId: string;
  label: string;
  kind: string;
  sponsor: { label: string; sold: boolean } | null;
  totalVotes: number;
  nominees: AwardNominee[];
}
export interface AwardEditionView {
  edition: AwardEdition;
  categories: AwardCategory[];
}
export interface AwardArchiveEntry {
  year: number;
  name: string;
  phase: string;
}
export interface GameAwardWin {
  year: number;
  editionName: string;
  categoryLabel: string;
  outcomeType: string;
}

/** The current edition (highest year) — Coming-Soon meta until staff publish. */
export async function getAwardsCurrent(): Promise<AwardEditionView | null> {
  try {
    const res = await fetch(`${backendUrl}/awards/current`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: AwardEditionView | null };
    return body.data ?? null;
  } catch {
    return null;
  }
}

/** A specific edition by year (archive detail). */
export async function getAwardsEdition(year: number): Promise<AwardEditionView | null> {
  try {
    const res = await fetch(`${backendUrl}/awards/editions/${year}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: AwardEditionView | null };
    return body.data ?? null;
  } catch {
    return null;
  }
}

/** The permanent archive index (published, decided editions). */
export async function getAwardsArchive(): Promise<AwardArchiveEntry[]> {
  try {
    const res = await fetch(`${backendUrl}/awards/archive`, { cache: 'no-store' });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: AwardArchiveEntry[] };
    return body.data ?? [];
  } catch {
    return [];
  }
}

// ── ads / promotions (I8) ────────────────────────────────────────────────────
export interface AdPlacementView {
  headline: string;
  body: string | null;
  ctaUrl: string | null;
  ctaLabel: string | null;
  advertiser: string;
  /** What is promoted (the label is "Promoted" either way). */
  game: { slug: string; name: string } | null;
  story: { slug: string; title: string } | null;
}
export interface AdSlotView {
  slotKey: string;
  fallback: string; // 'ad' | 'organic' | 'hide'
  format: string;
  placement: AdPlacementView | null;
  /** For a slot inside a list (the story coverage list): its 1-based row. */
  listPosition: number | null;
  /** `ads.showUnsoldPlaceholder` (S2, default false): unsold → render nothing. */
  showPlaceholder: boolean;
}
export interface GamePromotion {
  advertiser: string;
  headline: string;
  ctaUrl: string | null;
}

/** What an on-site AdSlot should render (live placement + fallback). */
export async function getAdSlot(key: string): Promise<AdSlotView | null> {
  try {
    const res = await fetch(`${backendUrl}/public/adslot/${encodeURIComponent(key)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: AdSlotView | null };
    return body.data ?? null;
  } catch {
    return null;
  }
}

/** An active promotion for a game (by slug) — the game-page Promoted badge. */
export async function getGamePromotion(slug: string): Promise<GamePromotion | null> {
  try {
    const res = await fetch(`${backendUrl}/public/promotion/${encodeURIComponent(slug)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: GamePromotion | null };
    return body.data ?? null;
  } catch {
    return null;
  }
}

/** Award wins for a game (by slug) — the game-page winner badge. */
export async function getGameAwardWins(slug: string): Promise<GameAwardWin[]> {
  try {
    const res = await fetch(`${backendUrl}/awards/game/${encodeURIComponent(slug)}/wins`, {
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: GameAwardWin[] };
    return body.data ?? [];
  } catch {
    return [];
  }
}

// ── Phase P S4: search ────────────────────────────────────────────────────────
export type SearchGroup = 'games' | 'stories' | 'sources';
export interface SearchHit {
  slug: string;
  title: string;
  subtitle: string | null;
  category: string | null;
}
export interface SearchResult {
  q: string;
  tooShort: boolean;
  groups: Record<SearchGroup, SearchHit[]>;
  totals?: Record<SearchGroup, number>;
  type?: SearchGroup | null;
  page?: number;
  pageSize?: number;
}
const EMPTY_SEARCH: SearchResult = {
  q: '',
  tooShort: true,
  groups: { games: [], stories: [], sources: [] },
  totals: { games: 0, stories: 0, sources: 0 },
};

/** The /search page (SSR). Never throws — an outage reads as "nothing found". */
export async function getSearch(q: string, type?: string, page?: number): Promise<SearchResult> {
  try {
    const qs = new URLSearchParams({ q: q.slice(0, 200) });
    if (type) qs.set('type', type);
    if (page && page > 1) qs.set('page', String(page));
    const res = await fetch(`${backendUrl}/public/search?${qs.toString()}`, { cache: 'no-store' });
    if (!res.ok) return { ...EMPTY_SEARCH, q };
    return ((await res.json()) as { data?: SearchResult }).data ?? { ...EMPTY_SEARCH, q };
  } catch {
    return { ...EMPTY_SEARCH, q };
  }
}

// ── Phase P S4: editorial lists (consensus only — never an outlet's full list) ─
export interface SitemapListPage {
  year: number;
  categoryKey: string;
  lastModified: string | null;
}
export interface ListsIndexEntry {
  year: number;
  categoryKey: string;
  label: string;
  lists: number;
  top: { slug: string; name: string }[];
}
export interface ListConsensus {
  year: number;
  category: { key: string; label: string };
  totalLists: number;
  lists: { outlet: string; title: string; url: string; publishedAt: string | null }[];
  rows: {
    position: number;
    game: { slug: string; name: string; releaseDate: string | null };
    appearances: number;
    avgRank: number;
    positions: { outlet: string; rank: number; url: string | null }[];
    lines: string[];
  }[];
  computedAt: string | null;
}
export interface GameEditorialLists {
  count: number;
  lists: {
    id: string;
    outlet: string;
    title: string;
    url: string;
    rank: number;
    year: number;
    category: string;
  }[];
  lines: string[];
  consensus: { year: number; categoryKey: string; label: string; position: number }[];
}

export async function getListsIndex(): Promise<ListsIndexEntry[]> {
  try {
    const res = await fetch(`${backendUrl}/public/lists`, { cache: 'no-store' });
    if (!res.ok) return [];
    return ((await res.json()) as { data?: ListsIndexEntry[] }).data ?? [];
  } catch {
    return [];
  }
}

/** One consensus page; null → 404 (not public, or no such year / category). */
export async function getListConsensus(
  year: number,
  category: string,
): Promise<ListConsensus | null> {
  try {
    const res = await fetch(
      `${backendUrl}/public/lists/${encodeURIComponent(String(year))}/${encodeURIComponent(category)}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return null;
    return ((await res.json()) as { data?: ListConsensus }).data ?? null;
  } catch {
    return null;
  }
}
