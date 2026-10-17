import {
  and,
  arrayOverlaps,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  type BiasBreakdown,
  type IntegritySignalKind,
  type DisconnectBand,
  type InfluenceFlag,
  type TopicBiasDistribution,
  type TopicFlagTally,
} from '@gameskeep/shared/constants';
import { db } from '../db/client';
import {
  appSettings,
  articleSubjects,
  articleTopics,
  articles,
  gameContentFlags,
  gameCriticReviews,
  gameDlc,
  gameExternalRatings,
  gamePlayerCounts,
  gamePrices,
  gameRatingSummaries,
  gameReviews,
  gameSystemRequirements,
  gameUserRatings,
  gameVideos,
  games,
  sources,
  sourceTypes,
  subjects,
  topics,
  topicTimelineEvents,
  topicTypes,
  users,
} from '../db/schema';
import { activeGamePromotions } from '../ads/service';
import {
  cardTags,
  gameSlugsByTag,
  publicTag,
  publicTagGroups,
  sitemapTags,
  tagFacets,
  type CardTag,
  type GameTagGroups,
  type TagFacet,
} from '../tags/service';
import { tagSettings } from '../tags/settings';
import { summaryEditorialSql, tldrEditorialSql } from '../articles/summary-approval';
import { publicCommunityNote, type PublicCommunityNote } from '../community/notes';
import { publicSteamSummary, type PublicSteamSummary } from '../steam/review-summary';
import { briefingOverrideToday, rulesSettings, rulesSnapshot } from '../rules/settings';
import { curateList, curationFor, curationsOf, type Curation } from '../curation/service';
import { brandName, copyState } from '../copy/settings';
import { indexableTopics, isTopicIndexable } from '../seo/indexing';
import { articleCategorySql, keysInModes, modeMap, newsCategories } from '../news/categories';
import { gameEditorialLists, type GameEditorialLists } from '../lists/service';
import { NEWS_FALLBACK_CATEGORY, type NewsCategoryMode } from '@gameskeep/shared/constants';
import { redis } from '../redis/client';
import { homepageSettings } from '../homepage/settings';
import { playersDelta } from '../homepage/rules';
import { listSections, sectionByKey } from '../homepage/sections';
import { readSnapshots } from '../homepage/snapshots';
import type { Delta } from '../homepage/rules';
import {
  flagsFromBreakdown,
  publicFlags,
  rowBiasMode,
  shapeRowSignals,
  emptyIntegrityTally,
  tallyArticle,
  topicShowsPanel,
  type BiasMode,
  type IntegrityTally,
} from '../display/scope';
import {
  displaySettings,
  publicDisplay,
  type DisplaySettings,
  type PublicDisplay,
} from '../display/settings';
import {
  publicIntegrityFor,
  publicIntegrityKinds,
  type PublicIntegrityRow,
} from '../articles/integrity';

/**
 * Public read-side composition (SPEC I5a) — the ONLY data the public homepage and
 * topic pages consume. Everything here is PRE-COMPUTED and stored (bias
 * distributions from I4a, rating summaries from I4b); nothing recomputes on the
 * request path (CLAUDE.md "nothing heavy on user request"). These payloads are
 * also the leak-proof surface: they select an explicit allowlist of columns and
 * NEVER touch `articles.internal_assessment` (the internal-only field) — that
 * column is not referenced anywhere in this file, by design.
 */

export type { BiasMode } from '../display/scope';

/**
 * The public face of a stored topic distribution: the article count, and the
 * quality split only while `bias.showQuality` is on (null otherwise). The
 * influence buckets are NOT public — they derive from scores that include the
 * engine's type-based review-copy inference.
 */
export interface PublicTopicDistribution {
  articleCount: number;
  quality: { top: number; slop: number; avg: number | null } | null;
}

/** A topic shaped as a homepage card (hero spotlight + main feed). */
export interface TopicCard {
  id: string;
  slug: string;
  title: string;
  tldr: string | null;
  /** The stored I3 AI summary (neutral "what happened"); labeled AI on render. */
  aiSummary: string | null;
  /**
   * Phase P S5 (EU AI Act transparency): true while the text is automatic AI
   * output → the locked "AI summary" label renders with it. False once an editor
   * edited or approved it (editorial content).
   */
  tldrIsAi: boolean;
  summaryIsAi: boolean;
  status: string;
  typeLabel: string | null;
  articleCount: number;
  sourceCount: number;
  /** Review articles in the topic (drives the default display scope). */
  reviewCount: number;
  /** Whether the topic-level bias panel renders (display scope). */
  showPanel: boolean;
  /** Most-linked game across the topic's articles — the cover/label subject. */
  primaryGame: { name: string; slug: string } | null;
  distribution: PublicTopicDistribution;
  /** Topic-level distribution of PUBLIC influence flags (counts, not a scale). */
  flags: TopicFlagTally;
  /** Public review-integrity rows beyond review copy (embargo / sponsored event). */
  integrityTally: IntegrityTally;
  lastActivityAt: string | null;
}

/** One article for the "Latest news" column (excerpt + link only — copyright). */
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
  /** Compact surface: at most a Sponsored chip under the default scope. */
  biasMode: BiasMode;
  /** The PUBLIC influence flags shown for this row (shaped by `biasMode`). */
  flags: InfluenceFlag[];
  /** Plain-language "why" for the hover tooltip (named signal labels). */
  reasons: string[];
}

/**
 * Today's briefing (Phase P S1): counts, never a percentage. The window is the
 * last `windowHours` up to now — or, when nothing arrived in that span, up to the
 * newest article (`isToday` false, `asOf` = that moment) so the label stays true.
 */
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

/** A browsable genre with how many catalog games carry it. */
export interface GenreCount {
  name: string;
  count: number;
}

/** A game shaped for the ranking + games-in-focus rails (0..100 internal). */
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

/** A game as a homepage section card (identity + the two public score layers). */
export interface HomepageGameCard {
  slug: string;
  name: string;
  coverUrl: string | null;
  status: string;
  releaseDate: string | null;
  genres: string[];
  /** Effective critic / community layers, 0..100 (null = no data). */
  critics: number | null;
  community: number | null;
}

export interface HomepageSectionItem {
  type: 'topic' | 'game';
  /** An editorial pin (never paid — pins carry no label). */
  pinned: boolean;
  /**
   * A PAID insert (any section — owner decision). Render-forced label: "Promoted"
   * for a game, "Sponsored" for a story. Organic entries: null.
   */
  paid: { advertiser: string; kind: 'game' | 'story' } | null;
  /** Trending / By players: vs the previous window of equal length. */
  delta: Delta | null;
  /** The section's ranking metric (score / average players / mean / gap). */
  metric: number | null;
  topic: TopicCard | null;
  game: HomepageGameCard | null;
  /**
   * Phase P S3: the card's tags — the section's configured families + count. A
   * story card shows its primary game's tags.
   */
  tags: CardTag[];
  /** Trending only: up to three outlets' headlines (excerpt + link posture). */
  coverage: HomepageCoverageRow[] | null;
}

/** One outlet's headline on a story — links OUT to the original. */
export interface HomepageCoverageRow {
  source: string;
  title: string;
  url: string | null;
}

/**
 * Up to three newest coverage rows per story, one per outlet. Our own articles
 * count too (labelled GamesKeep, no outbound link — they have no external URL);
 * outlet rows link OUT to the original (excerpt + link posture).
 */
async function coverageRowsFor(
  topicIds: string[],
  opts: { max: number; curation: Map<string, Curation> } = { max: 3, curation: new Map() },
): Promise<Map<string, HomepageCoverageRow[]>> {
  const out = new Map<string, HomepageCoverageRow[]>();
  if (topicIds.length === 0 || opts.max <= 0) return out;
  const rows = await db
    .select({
      topicId: articleTopics.topicId,
      title: articles.title,
      url: articles.url,
      origin: articles.origin,
      source: sources.name,
      sourceSlug: sources.slug,
    })
    .from(articleTopics)
    .innerJoin(articles, eq(articles.id, articleTopics.articleId))
    .leftJoin(sources, eq(sources.id, articles.sourceId))
    .where(inArray(articleTopics.topicId, topicIds))
    .orderBy(desc(articles.publishDate));
  // One newest row per outlet, per story; then the editor's picks / exclusions
  // (Phase P S3b — by source slug, "ours" for our own articles) and the count rule.
  const perTopic = new Map<string, (HomepageCoverageRow & { key: string })[]>();
  for (const r of rows) {
    const ours = r.origin === 'ours';
    const source = r.source ?? (ours ? brandName() : null);
    if (!source) continue;
    const key = ours ? 'ours' : (r.sourceSlug ?? source);
    const list = perTopic.get(r.topicId) ?? [];
    if (list.some((x) => x.key === key)) continue;
    list.push({ key, source, title: r.title, url: ours ? null : (r.url ?? null) });
    perTopic.set(r.topicId, list);
  }
  for (const [topicId, list] of perTopic) {
    const cur = opts.curation.get(topicId) ?? { pins: [], excludes: [] };
    out.set(
      topicId,
      curateList(list, (x) => x.key, cur, opts.max).map(({ source, title, url }) => ({
        source,
        title,
        url,
      })),
    );
  }
  return out;
}

/** One enabled homepage section, in the admin's page order. */
export interface HomepageSection {
  key: string;
  kind: string;
  title: string;
  /** The Δ window in hours (Trending / By players), else null. */
  windowHours: number | null;
  items: HomepageSectionItem[];
}

export interface HomepageData {
  /** Phase P S2: the admin-configured sections, in page order (enabled only). */
  sections: HomepageSection[];
  /** When the snapshots job last stored the sections (null = not yet computed). */
  computedAt: string | null;
  // The rails below are views of the same snapshots (kept for the current page).
  hero: TopicCard[];
  feed: TopicCard[];
  latest: LatestArticle[];
  topRated: RankedGame[];
  controversial: RankedGame[];
  briefing: Briefing;
  genres: GenreCount[];
  display: PublicDisplay;
}

function emptyFlagTally(): TopicFlagTally {
  return { total: 0, independent: 0, sponsored: 0, affiliate: 0, reviewCopy: 0, opinion: 0 };
}

/** Public integrity kinds per article id (see `publicIntegrityKinds`). */
type IntegrityEvidence = Map<string, Set<IntegritySignalKind>>;

function hasReviewCopy(evidence: IntegrityEvidence, articleId: string): boolean {
  return evidence.get(articleId)?.has('review_copy') ?? false;
}

/** Quality values are public only while `bias.showQuality` is on. */
function publicDistribution(
  d: TopicBiasDistribution,
  showQuality: boolean,
): PublicTopicDistribution {
  return {
    articleCount: d.articleCount,
    quality: showQuality ? { top: d.quality.top, slop: d.quality.slop, avg: d.quality.avg } : null,
  };
}

/**
 * Topic-level distribution of PUBLIC influence flags across each topic's articles
 * (counts, not a score) + how many are reviews. The flags are facts from the
 * stored breakdown (independent of score overrides), filtered by `publicFlags`,
 * plus the public integrity rows (embargo / sponsored event). `independent` is
 * the internal key for "no public signal found" — see `tallyArticle`.
 */
interface TopicTallyEntry {
  tally: TopicFlagTally;
  integrity: IntegrityTally;
  reviews: number;
}

function emptyTopicTally(): TopicTallyEntry {
  return { tally: emptyFlagTally(), integrity: emptyIntegrityTally(), reviews: 0 };
}

async function flagTallyByTopic(
  topicIds: string[],
  evidence: IntegrityEvidence,
): Promise<Map<string, TopicTallyEntry>> {
  const map = new Map<string, TopicTallyEntry>();
  if (topicIds.length === 0) return map;
  const rows = await db
    .select({
      topicId: articleTopics.topicId,
      articleId: articles.id,
      articleType: articles.articleType,
      breakdown: articles.influenceBreakdown,
    })
    .from(articleTopics)
    .innerJoin(articles, eq(articleTopics.articleId, articles.id))
    .where(inArray(articleTopics.topicId, topicIds));

  for (const r of rows) {
    const entry = map.get(r.topicId) ?? emptyTopicTally();
    if (r.articleType === 'review') entry.reviews += 1;
    const flags = publicFlags(r.breakdown, r.articleType, hasReviewCopy(evidence, r.articleId));
    tallyArticle(entry.tally, entry.integrity, flags, evidence.get(r.articleId));
    map.set(r.topicId, entry);
  }
  return map;
}

/** Distinct-source count per topic (the "X outlets covered this" signal). */
async function sourceCountsByTopic(topicIds: string[]): Promise<Map<string, number>> {
  const rows = await db
    .select({
      topicId: articleTopics.topicId,
      n: sql<number>`count(distinct ${articles.sourceId})::int`,
    })
    .from(articleTopics)
    .innerJoin(articles, eq(articleTopics.articleId, articles.id))
    .where(and(inArray(articleTopics.topicId, topicIds), isNotNull(articles.sourceId)))
    .groupBy(articleTopics.topicId);
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.topicId, Number(r.n));
  return map;
}

/** The most-frequently-linked game per topic (its cover/label subject). */
async function primaryGameByTopic(
  topicIds: string[],
): Promise<Map<string, { name: string; slug: string }>> {
  const rows = await db
    .select({
      topicId: articleTopics.topicId,
      name: subjects.name,
      slug: subjects.slug,
      n: sql<number>`count(*)::int`,
    })
    .from(articleTopics)
    .innerJoin(articleSubjects, eq(articleSubjects.articleId, articleTopics.articleId))
    .innerJoin(subjects, and(eq(subjects.id, articleSubjects.subjectId), eq(subjects.type, 'game')))
    .where(inArray(articleTopics.topicId, topicIds))
    .groupBy(articleTopics.topicId, subjects.name, subjects.slug);

  const best = new Map<string, { name: string; slug: string; n: number }>();
  for (const r of rows) {
    const prev = best.get(r.topicId);
    const n = Number(r.n);
    if (!prev || n > prev.n) best.set(r.topicId, { name: r.name, slug: r.slug, n });
  }
  const out = new Map<string, { name: string; slug: string }>();
  for (const [topicId, v] of best) out.set(topicId, { name: v.name, slug: v.slug });
  return out;
}

/** Every topic that carries a stored bias distribution, shaped as a card. */
async function loadTopicCards(
  settings: DisplaySettings,
  evidence: IntegrityEvidence,
): Promise<TopicCard[]> {
  const topicRows = await db
    .select({
      id: topics.id,
      slug: topics.slug,
      title: topics.title,
      tldr: topics.tldr,
      aiSummary: topics.aiSummary,
      tldrEditorial: tldrEditorialSql,
      summaryEditorial: summaryEditorialSql,
      status: topics.status,
      typeLabel: topicTypes.label,
      distribution: topics.biasDistribution,
      lastActivityAt: topics.lastActivityAt,
    })
    .from(topics)
    .leftJoin(topicTypes, eq(topics.typeId, topicTypes.id))
    .where(isNotNull(topics.biasDistribution));

  // A public story must actually have articles — a stored distribution with
  // articleCount 0 is a structural artifact (e.g. an empty admin/test topic) and
  // must never surface (anti-bug rule: never assume the data is well-formed).
  const withDist = topicRows.filter(
    (t): t is typeof t & { distribution: TopicBiasDistribution } =>
      t.distribution != null && t.distribution.articleCount > 0,
  );
  if (withDist.length === 0) return [];

  const ids = withDist.map((t) => t.id);
  const [sourceCounts, primaryGames, flagTallies] = await Promise.all([
    sourceCountsByTopic(ids),
    primaryGameByTopic(ids),
    flagTallyByTopic(ids, evidence),
  ]);

  return withDist.map((t) => {
    const entry = flagTallies.get(t.id) ?? emptyTopicTally();
    return {
      id: t.id,
      slug: t.slug,
      title: t.title,
      tldr: t.tldr,
      aiSummary: t.aiSummary,
      tldrIsAi: Boolean(t.tldr) && !t.tldrEditorial,
      summaryIsAi: Boolean(t.aiSummary) && !t.summaryEditorial,
      status: t.status,
      typeLabel: t.typeLabel,
      articleCount: t.distribution.articleCount,
      sourceCount: sourceCounts.get(t.id) ?? 0,
      reviewCount: entry.reviews,
      showPanel: topicShowsPanel(settings.displayScope, entry.tally, entry.reviews),
      primaryGame: primaryGames.get(t.id) ?? null,
      distribution: publicDistribution(t.distribution, settings.showQuality),
      flags: entry.tally,
      integrityTally: entry.integrity,
      lastActivityAt: t.lastActivityAt ? t.lastActivityAt.toISOString() : null,
    };
  });
}

/**
 * Named influence signals from a stored breakdown — the public "why". On a review
 * the type-inferred review-copy contribution is dropped (see `publicFlags`).
 */
function influenceReasons(breakdown: BiasBreakdown | null, articleType: string): string[] {
  if (!breakdown) return [];
  const isReview = articleType === 'review';
  return breakdown.contributions
    .filter((c) => c.points > 0 && c.signal !== 'sourceBaseline' && c.signal !== 'baselineNeutral')
    .filter((c) => !(isReview && c.signal === 'reviewCopy'))
    .sort((a, b) => b.points - a.points)
    .slice(0, rulesSnapshot().lists.whyReasons)
    .map((c) => c.label);
}

/** Public flags + reasons for one row, shaped for its surface and the display scope. */
function rowSignals(
  r: { id: string; articleType: string; influenceBreakdown: BiasBreakdown | null },
  surface: 'detail' | 'compact',
  scope: DisplaySettings['displayScope'],
  evidence: IntegrityEvidence,
): { isReview: boolean; biasMode: BiasMode; flags: InfluenceFlag[]; reasons: string[] } {
  const isReview = r.articleType === 'review';
  const flags = publicFlags(r.influenceBreakdown, r.articleType, hasReviewCopy(evidence, r.id));
  const biasMode = rowBiasMode(scope, surface, isReview, flags);
  const shaped = shapeRowSignals(
    biasMode,
    isReview,
    flags,
    influenceReasons(r.influenceBreakdown, r.articleType),
  );
  return { isReview, biasMode, ...shaped };
}

/** Phase P S4: `expr NOT IN (keys)` — or nothing when there is nothing to exclude. */
function notInCategories(expr: SQL, keys: string[]): SQL | undefined {
  return keys.length
    ? sql`${expr} NOT IN (${sql.join(
        keys.map((k) => sql`${k}`),
        sql`, `,
      )})`
    : undefined;
}

/** Phase P S4: the news categories as the public reads need them. */
async function categoryContext(): Promise<{
  labels: Map<string, string>;
  modes: Map<string, NewsCategoryMode>;
  hide: string[];
  lowHide: string[];
}> {
  const cats = await newsCategories();
  return {
    labels: new Map(cats.map((c) => [c.key, c.label])),
    modes: modeMap(cats),
    hide: keysInModes(cats, ['hide']),
    lowHide: keysInModes(cats, ['low', 'hide']),
  };
}
const topicCategorySql = sql`coalesce(${topics.category}, ${NEWS_FALLBACK_CATEGORY})`;

interface DetailRowInput {
  /** Phase P S4: the effective news category key. */
  category?: string | null;
  id: string;
  title: string;
  excerpt: string | null;
  url: string | null;
  origin: string;
  author: string | null;
  articleType: string;
  publishDate: Date | null;
  sourceName: string | null;
  sourceSlug: string | null;
  qualityScore?: number | null;
  qualityOverride?: number | null;
  influenceBreakdown: BiasBreakdown | null;
}

/**
 * Shape article rows for a DETAIL list (topic coverage, game Reviews / news,
 * source coverage): public flags by display scope, quality only while shown, and
 * the public integrity rows on every review. One place, so every surface agrees.
 */
async function detailRows(
  rows: DetailRowInput[],
  settings: DisplaySettings,
  evidence: IntegrityEvidence,
  cats?: { labels: Map<string, string>; modes: Map<string, NewsCategoryMode> },
): Promise<TopicArticleRow[]> {
  const reviewIds = rows.filter((r) => r.articleType === 'review').map((r) => r.id);
  const integrity = await publicIntegrityFor(reviewIds, settings.integrityAutoPublish);
  return rows.map((r) => {
    const s = rowSignals(r, 'detail', settings.displayScope, evidence);
    return {
      id: r.id,
      title: r.title,
      excerpt: r.excerpt,
      url: r.url,
      origin: r.origin,
      author: r.origin === 'ours' ? r.author : null,
      articleType: r.articleType,
      publishDate: r.publishDate ? r.publishDate.toISOString() : null,
      sourceName: r.sourceName,
      sourceSlug: r.sourceSlug,
      quality: settings.showQuality ? (r.qualityOverride ?? r.qualityScore ?? null) : null,
      isReview: s.isReview,
      biasMode: s.biasMode,
      flags: s.flags,
      reasons: s.reasons,
      integrity: s.isReview ? (integrity.get(r.id) ?? []) : null,
      // Phase P S4: a chip for an article outside the "show" categories.
      category:
        cats && r.category && (cats.modes.get(r.category) ?? 'show') !== 'show'
          ? (cats.labels.get(r.category) ?? r.category)
          : null,
    };
  });
}

/** Newest aggregated articles for the "Latest news" column (excerpt + link only). */
async function loadLatestArticles(
  limit: number,
  settings: DisplaySettings,
  evidence: IntegrityEvidence,
): Promise<LatestArticle[]> {
  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      origin: articles.origin,
      url: articles.url,
      excerpt: articles.excerpt,
      publishDate: articles.publishDate,
      articleType: articles.articleType,
      sourceName: sources.name,
      sourceSlug: sources.slug,
      influenceBreakdown: articles.influenceBreakdown,
    })
    .from(articles)
    .leftJoin(sources, eq(articles.sourceId, sources.id))
    .where(
      and(
        isNotNull(articles.publishDate),
        // Phase P S4: "low" and "hide" categories never reach the Latest rail.
        notInCategories(articleCategorySql, (await categoryContext()).lowHide),
      ),
    )
    .orderBy(desc(articles.publishDate))
    .limit(limit);

  return rows.map((r) => {
    const s = rowSignals(r, 'compact', settings.displayScope, evidence);
    return {
      id: r.id,
      title: r.title,
      sourceName: r.sourceName,
      sourceSlug: r.sourceSlug,
      url: r.url,
      excerpt: r.excerpt,
      publishDate: r.publishDate ? r.publishDate.toISOString() : null,
      origin: r.origin,
      articleType: r.articleType,
      biasMode: s.biasMode,
      flags: s.flags,
      reasons: s.reasons,
    };
  });
}

/** Top genres across the catalog (the "browse by genre" rail). */
async function loadGenres(limit = 12): Promise<GenreCount[]> {
  const res = await db.execute(sql`
    SELECT g AS name, count(*)::int AS n
    FROM (SELECT unnest(genres) AS g FROM games WHERE genres IS NOT NULL) s
    GROUP BY g
    ORDER BY n DESC
    LIMIT ${limit}
  `);
  const raw = res as unknown as
    | { rows?: { name: string; n: number | string }[] }
    | { name: string; n: number | string }[];
  const rows = Array.isArray(raw) ? raw : (raw.rows ?? []);
  return rows.map((r) => ({ name: String(r.name), count: Number(r.n) }));
}

function effective(auto: number | null, override: number | null): number | null {
  return override ?? auto ?? null;
}

/**
 * Phase P S5 — the team (our) score is public ONLY when `editorial.teamScore` is
 * on (default off), and it never ranks, orders or qualifies anything — it is
 * never part of an aggregate. One gate for every public payload.
 */
async function teamScoreOn(): Promise<boolean> {
  return (await rulesSettings()).editorial.teamScore;
}
const teamOnly = (on: boolean, v: number | null | undefined): number | null =>
  on ? (v ?? null) : null;

/** Games with a rating summary — the ranking + disconnect rails. */
async function loadRankedGames(): Promise<RankedGame[]> {
  const rows = await db
    .select({
      slug: subjects.slug,
      name: subjects.name,
      our: gameRatingSummaries.ourScore,
      criticsAuto: gameRatingSummaries.criticsScore,
      criticsOverride: gameRatingSummaries.criticsOverride,
      communityAuto: gameRatingSummaries.communityOurScore,
      communityOverride: gameRatingSummaries.communityOverride,
      web: gameRatingSummaries.communityWebScore,
      disconnectValue: gameRatingSummaries.disconnectValue,
      disconnectBand: gameRatingSummaries.disconnectBand,
    })
    .from(gameRatingSummaries)
    .innerJoin(games, eq(gameRatingSummaries.gameId, games.id))
    .innerJoin(subjects, eq(games.subjectId, subjects.id))
    // Only games with at least one REAL score — the recompute writes a summary
    // row for every catalog game, so without this an unscored game would leak
    // into the public rankings (matches the admin's no-data filter).
    // (Phase P S5: our score alone never qualifies a game — it is not an aggregate.)
    .where(
      or(
        isNotNull(gameRatingSummaries.criticsScore),
        isNotNull(gameRatingSummaries.communityOurScore),
      ),
    );

  const team = await teamScoreOn();
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    our: teamOnly(team, r.our),
    critics: effective(r.criticsAuto, r.criticsOverride),
    community: effective(r.communityAuto, r.communityOverride),
    web: r.web ?? null,
    disconnectValue: r.disconnectValue ?? null,
    disconnectBand: r.disconnectBand ?? null,
  }));
}

/**
 * Today's briefing (Phase P S1): sources · topics · reviews in the window — never
 * a percentage. The window is `windowHours` up to NOW when coverage arrived in
 * that span; otherwise it ends at the newest article and says so (`isToday`
 * false + `asOf`), so a quiet feed (or the fixed-date demo feed) never shows a
 * false "today". Topics count only public ones (a stored distribution).
 */
async function buildBriefing(windowHours: number): Promise<Briefing> {
  const empty: Briefing = {
    isToday: true,
    asOf: null,
    windowHours,
    sources: 0,
    topics: 0,
    reviews: 0,
  };
  const [anchorRow] = await db
    .select({ t: sql<Date | null>`max(${articles.publishDate})` })
    .from(articles)
    .where(sql`${articles.publishDate} <= now()`);
  const anchor = anchorRow?.t ? new Date(anchorRow.t) : null;
  if (!anchor || Number.isNaN(anchor.getTime())) return empty;

  const now = Date.now();
  const windowMs = windowHours * 3_600_000;
  const isToday = now - anchor.getTime() <= windowMs;
  const hi = new Date(isToday ? now : anchor.getTime());
  const lo = new Date(hi.getTime() - windowMs);

  // Phase P S4: "low" and "hide" categories never count in the briefing.
  const { lowHide } = await categoryContext();
  const artOk =
    notInCategories(
      sql`coalesce(a.category_override, a.category, ${NEWS_FALLBACK_CATEGORY})`,
      lowHide,
    ) ?? sql`true`;
  const topicOk =
    notInCategories(sql`coalesce(t.category, ${NEWS_FALLBACK_CATEGORY})`, lowHide) ?? sql`true`;
  const res = await db.execute(sql`
    SELECT
      (SELECT count(DISTINCT a.source_id)::int FROM articles a
        WHERE a.source_id IS NOT NULL AND a.publish_date > ${lo} AND a.publish_date <= ${hi}
          AND ${artOk}) AS sources,
      (SELECT count(DISTINCT at.topic_id)::int FROM article_topics at
        JOIN articles a ON a.id = at.article_id
        JOIN topics t ON t.id = at.topic_id
        WHERE t.bias_distribution IS NOT NULL
          AND a.publish_date > ${lo} AND a.publish_date <= ${hi} AND ${topicOk}) AS topics,
      (SELECT count(*)::int FROM articles a
        WHERE a.article_type = 'review' AND a.publish_date > ${lo} AND a.publish_date <= ${hi}
          AND ${artOk}) AS reviews
  `);
  const raw = res as unknown as { rows?: Record<string, unknown>[] } | Record<string, unknown>[];
  const row = (Array.isArray(raw) ? raw[0] : raw.rows?.[0]) ?? {};
  return {
    isToday,
    asOf: isToday ? null : anchor.toISOString(),
    windowHours,
    sources: Number(row.sources ?? 0),
    topics: Number(row.topics ?? 0),
    reviews: Number(row.reviews ?? 0),
  };
}

/** Section game cards for a set of slugs (identity + the two public layers). */
async function loadHomepageGameCards(slugs: string[]): Promise<Map<string, HomepageGameCard>> {
  if (slugs.length === 0) return new Map();
  const rows = await db
    .select({
      slug: subjects.slug,
      name: subjects.name,
      coverUrl: games.coverUrl,
      status: games.status,
      releaseDate: games.releaseDate,
      genres: games.genres,
      criticsAuto: gameRatingSummaries.criticsScore,
      criticsOverride: gameRatingSummaries.criticsOverride,
      communityAuto: gameRatingSummaries.communityOurScore,
      communityOverride: gameRatingSummaries.communityOverride,
    })
    .from(games)
    .innerJoin(subjects, and(eq(games.subjectId, subjects.id), eq(subjects.type, 'game')))
    .leftJoin(gameRatingSummaries, eq(gameRatingSummaries.gameId, games.id))
    .where(inArray(subjects.slug, slugs));
  return new Map(
    rows.map((r) => [
      r.slug,
      {
        slug: r.slug,
        name: r.name,
        coverUrl: publicAssetUrl(r.coverUrl),
        status: r.status,
        releaseDate: r.releaseDate ?? null,
        genres: r.genres ?? [],
        critics: effective(r.criticsAuto, r.criticsOverride),
        community: effective(r.communityAuto, r.communityOverride),
      },
    ]),
  );
}

/**
 * The homepage payload (Phase P S2). The section CONTENTS are read from the
 * stored snapshots (ranking, Δ windows, pins and the Promoted item were decided
 * by the snapshots job) and only hydrated here; display shaping (bias scope)
 * still applies per request. A snapshot that names a story or game that no
 * longer exists is skipped — never a broken card.
 */
export async function getHomepageData(): Promise<HomepageData> {
  const settings = await displaySettings();
  await copyState(); // the brand labels our own coverage rows (sync read below)
  const evidence = await publicIntegrityKinds(settings.integrityAutoPublish);
  const [cards, latest, ranked, genres, briefing, sections, snapshots] = await Promise.all([
    loadTopicCards(settings, evidence),
    loadLatestArticles(10, settings, evidence),
    loadRankedGames(),
    loadGenres(),
    buildBriefing(settings.briefingWindowHours),
    listSections(),
    readSnapshots(),
  ]);
  const cardBySlug = new Map(cards.map((c) => [c.slug, c]));
  const rankedBySlug = new Map(ranked.map((g) => [g.slug, g]));
  const gameSlugs = new Set<string>();
  for (const snap of snapshots.values()) {
    for (const it of snap.payload.items ?? []) if (it.type === 'game') gameSlugs.add(it.slug);
  }
  const gameCards = await loadHomepageGameCards([...gameSlugs]);
  // Card tags (S3): the games shown + every story's primary game.
  const tagSlugs = new Set<string>(gameSlugs);
  for (const c of cards) if (c.primaryGame) tagSlugs.add(c.primaryGame.slug);
  const gameIdRows = tagSlugs.size
    ? await db
        .select({ id: games.id, slug: subjects.slug })
        .from(games)
        .innerJoin(subjects, and(eq(games.subjectId, subjects.id), eq(subjects.type, 'game')))
        .where(inArray(subjects.slug, [...tagSlugs]))
    : [];
  const gameIdBySlug = new Map(gameIdRows.map((r) => [r.slug, r.id]));
  const tagGroupsById = await publicTagGroups(gameIdRows.map((r) => r.id));
  const groupsOfSlug = (slug: string | null | undefined): GameTagGroups | undefined =>
    slug ? tagGroupsById.get(gameIdBySlug.get(slug) ?? '') : undefined;
  const trendingIds = (snapshots.get('trending')?.payload.items ?? [])
    .map((it) => cardBySlug.get(it.slug)?.id)
    .filter((id): id is string => Boolean(id));
  const rules = await rulesSettings();
  const coverageCur = await curationsOf('topic', 'coverage-rows');
  const coverageBySlugToId = new Map(cards.map((c) => [c.slug, c.id]));
  const coverageCurById = new Map<string, Curation>();
  for (const [slug, cur] of coverageCur) {
    const id = coverageBySlugToId.get(slug);
    if (id) coverageCurById.set(id, cur);
  }
  const coverage = await coverageRowsFor(trendingIds, {
    max: rules.homepage.coverageRows,
    curation: coverageCurById,
  });
  // Phase P S3b: today's briefing override (text instead of the counts, or hidden).
  const briefingToday = await briefingOverrideToday();

  let computedAt: string | null = null;
  const out: HomepageSection[] = [];
  for (const sec of sections) {
    if (!sec.enabled) continue;
    if (sec.key === 'briefing' && briefingToday?.hidden) continue;
    const snap = snapshots.get(sec.key);
    if (snap && (!computedAt || snap.computedAt.toISOString() > computedAt)) {
      computedAt = snap.computedAt.toISOString();
    }
    const items: HomepageSectionItem[] = [];
    for (const it of snap?.payload.items ?? []) {
      const topic = it.type === 'topic' ? (cardBySlug.get(it.slug) ?? null) : null;
      const game = it.type === 'game' ? (gameCards.get(it.slug) ?? null) : null;
      if (!topic && !game) continue;
      items.push({
        type: it.type,
        pinned: it.pinned === true,
        paid:
          it.paid && (it.paid.kind === 'game' || it.paid.kind === 'story')
            ? { advertiser: it.paid.advertiser, kind: it.paid.kind }
            : null,
        delta: it.delta ?? null,
        metric: typeof it.metric === 'number' ? it.metric : null,
        topic,
        game,
        tags: cardTags(
          groupsOfSlug(game ? game.slug : topic?.primaryGame?.slug),
          sec.cardTagFamilies,
          sec.cardTagCount,
        ),
        coverage: sec.key === 'trending' && topic ? (coverage.get(topic.id) ?? []) : null,
      });
    }
    out.push({
      key: sec.key,
      kind: sec.kind,
      title: sec.title,
      windowHours: sec.delta ? sec.deltaWindowHours : null,
      items,
    });
  }

  const sectionOf = (key: string): HomepageSection | undefined => out.find((x) => x.key === key);
  // The rails below are ORGANIC views (paid inserts excluded — data views).
  const topicCardsOf = (key: string): TopicCard[] =>
    (sectionOf(key)?.items ?? [])
      .filter((i) => !i.paid)
      .map((i) => i.topic)
      .filter((t): t is TopicCard => t !== null);
  const rankedOf = (key: string): RankedGame[] =>
    (sectionOf(key)?.items ?? [])
      .filter((i) => !i.paid)
      .map((i) => (i.game ? (rankedBySlug.get(i.game.slug) ?? null) : null))
      .filter((g): g is RankedGame => g !== null);

  return {
    sections: out,
    computedAt,
    hero: topicCardsOf('trending'),
    feed: topicCardsOf('latest'),
    latest,
    topRated: rankedOf('top_rated'),
    controversial: rankedOf('focus'),
    genres,
    briefing: { ...briefing, overrideText: briefingToday?.text ?? null },
    display: publicDisplay(settings),
  };
}

// ── topic / story detail (SPEC I5a; BLUEPRINT 3.3) ───────────────────────────

/** One source's article on a story page (excerpt + link only — I1 copyright). */
export interface TopicArticleRow {
  id: string;
  title: string;
  excerpt: string | null;
  url: string | null;
  origin: string;
  /** Shown ONLY for our own articles — enforced here, null for aggregated. */
  author: string | null;
  articleType: string;
  publishDate: string | null;
  sourceName: string | null;
  sourceSlug: string | null;
  /** Effective quality (override ?? auto) — null while `bias.showQuality` is off. */
  quality: number | null;
  isReview: boolean;
  /** How this row shows its signals (display scope; decided server-side). */
  biasMode: BiasMode;
  /** PUBLIC influence flags, shaped by `biasMode` (none ⇒ "No signals found"). */
  flags: InfluenceFlag[];
  /** Named signal labels for the hover "why". */
  reasons: string[];
  /** Review rows only: the public integrity rows (empty ⇒ "No signals found"). */
  integrity: PublicIntegrityRow[] | null;
  /** Phase P S4: the category label when it is a "low" / "hide" one (a chip); else null. */
  category: string | null;
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

/** Primary linked game's rating summary — drives the AggregateRating schema. */
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
  /** Phase P S3b: an editor kept this story out of search indexes. */
  noindex: boolean;
  title: string;
  tldr: string | null;
  aiSummary: string | null;
  /** Phase P S5: automatic AI text → the locked "AI summary" label (false once editorial). */
  tldrIsAi: boolean;
  summaryIsAi: boolean;
  status: string;
  typeLabel: string | null;
  publishedAt: string | null;
  lastActivityAt: string | null;
  articleCount: number;
  sourceCount: number;
  reviewCount: number;
  /** Whether the topic-level bias panel renders (display scope). */
  showPanel: boolean;
  distribution: PublicTopicDistribution;
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

/** Every game subject linked across a topic's articles, most-linked first. */
async function linkedGamesForTopic(
  topicId: string,
): Promise<{ subjectId: string; name: string; slug: string }[]> {
  const rows = await db
    .select({
      subjectId: subjects.id,
      name: subjects.name,
      slug: subjects.slug,
      n: sql<number>`count(*)::int`,
    })
    .from(articleTopics)
    .innerJoin(articleSubjects, eq(articleSubjects.articleId, articleTopics.articleId))
    .innerJoin(subjects, and(eq(subjects.id, articleSubjects.subjectId), eq(subjects.type, 'game')))
    .where(eq(articleTopics.topicId, topicId))
    .groupBy(subjects.id, subjects.name, subjects.slug)
    .orderBy(desc(sql`count(*)`));
  return rows.map((r) => ({ subjectId: r.subjectId, name: r.name, slug: r.slug }));
}

/** The primary linked game's rating summary (if it has a real score). */
async function gameRatingForSubject(subjectId: string): Promise<TopicGameRating | null> {
  const [r] = await db
    .select({
      slug: subjects.slug,
      name: subjects.name,
      our: gameRatingSummaries.ourScore,
      criticsAuto: gameRatingSummaries.criticsScore,
      criticsOverride: gameRatingSummaries.criticsOverride,
      criticsCount: gameRatingSummaries.criticsOutletCount,
      communityAuto: gameRatingSummaries.communityOurScore,
      communityOverride: gameRatingSummaries.communityOverride,
      communityCount: gameRatingSummaries.communityOurCount,
    })
    .from(gameRatingSummaries)
    .innerJoin(games, eq(gameRatingSummaries.gameId, games.id))
    .innerJoin(subjects, eq(games.subjectId, subjects.id))
    .where(eq(games.subjectId, subjectId))
    .limit(1);
  if (!r) return null;
  const critics = effective(r.criticsAuto, r.criticsOverride);
  const community = effective(r.communityAuto, r.communityOverride);
  const our = teamOnly(await teamScoreOn(), r.our);
  if (our == null && critics == null && community == null) return null;
  return {
    slug: r.slug,
    name: r.name,
    our,
    critics,
    community,
    criticsOutletCount: r.criticsCount ?? null,
    communityCount: r.communityCount ?? null,
  };
}

/** Story cards for pinned slugs (Phase P S3b — a pin may point outside the auto list). */
async function relatedTopicCardsBySlug(slugs: string[]): Promise<Map<string, RelatedTopic>> {
  if (slugs.length === 0) return new Map();
  const rows = await db
    .select({
      id: topics.id,
      slug: topics.slug,
      title: topics.title,
      distribution: topics.biasDistribution,
    })
    .from(topics)
    .where(and(inArray(topics.slug, slugs), isNotNull(topics.biasDistribution)));
  const counts = await sourceCountsByTopic(rows.map((r) => r.id));
  return new Map(
    rows
      .filter((t) => (t.distribution?.articleCount ?? 0) > 0)
      .map((t) => [
        t.slug,
        {
          slug: t.slug,
          title: t.title,
          articleCount: t.distribution?.articleCount ?? 0,
          sourceCount: counts.get(t.id) ?? 0,
        },
      ]),
  );
}

/** Game cards for pinned slugs (Phase P S3b). */
async function relatedGameCardsBySlug(slugs: string[]): Promise<Map<string, RelatedGame>> {
  if (slugs.length === 0) return new Map();
  const rows = await db
    .select({
      slug: subjects.slug,
      name: subjects.name,
      genres: games.genres,
      our: gameRatingSummaries.ourScore,
      criticsAuto: gameRatingSummaries.criticsScore,
      criticsOverride: gameRatingSummaries.criticsOverride,
      communityAuto: gameRatingSummaries.communityOurScore,
      communityOverride: gameRatingSummaries.communityOverride,
    })
    .from(games)
    .innerJoin(subjects, and(eq(games.subjectId, subjects.id), eq(subjects.type, 'game')))
    .leftJoin(gameRatingSummaries, eq(gameRatingSummaries.gameId, games.id))
    .where(inArray(subjects.slug, slugs));
  const team = await teamScoreOn();
  return new Map(
    rows.map((r) => [
      r.slug,
      {
        slug: r.slug,
        name: r.name,
        genres: r.genres ?? [],
        our: teamOnly(team, r.our),
        critics: effective(r.criticsAuto, r.criticsOverride),
        community: effective(r.communityAuto, r.communityOverride),
      },
    ]),
  );
}

/** Other stories about the same primary game (graceful: [] when none). */
async function relatedTopicsForGame(
  gameSubjectId: string,
  excludeTopicId: string,
): Promise<RelatedTopic[]> {
  const idRows = await db
    .selectDistinct({ topicId: articleTopics.topicId })
    .from(articleTopics)
    .innerJoin(articleSubjects, eq(articleSubjects.articleId, articleTopics.articleId))
    .where(
      and(eq(articleSubjects.subjectId, gameSubjectId), ne(articleTopics.topicId, excludeTopicId)),
    )
    .limit(48);
  const ids = idRows.map((r) => r.topicId);
  if (ids.length === 0) return [];

  const [rows, sourceCounts] = await Promise.all([
    db
      .select({
        id: topics.id,
        slug: topics.slug,
        title: topics.title,
        distribution: topics.biasDistribution,
        lastActivityAt: topics.lastActivityAt,
      })
      .from(topics)
      .where(
        and(
          inArray(topics.id, ids),
          isNotNull(topics.biasDistribution),
          // Phase P S4: stories in a "hide" category are not offered as related.
          notInCategories(topicCategorySql, (await categoryContext()).hide),
        ),
      ),
    sourceCountsByTopic(ids),
  ]);

  return rows
    .filter((t) => (t.distribution?.articleCount ?? 0) > 0)
    .map((t) => ({
      slug: t.slug,
      title: t.title,
      articleCount: t.distribution?.articleCount ?? 0,
      sourceCount: sourceCounts.get(t.id) ?? 0,
      activity: t.lastActivityAt ? t.lastActivityAt.getTime() : 0,
    }))
    .sort((a, b) => b.activity - a.activity)
    .map(({ slug, title, articleCount, sourceCount }) => ({
      slug,
      title,
      articleCount,
      sourceCount,
    }));
}

/**
 * Full story page payload for `/topics/[slug]` (leak-proof; pre-computed). Reads
 * the same stored bias data as the homepage, plus every source's article row,
 * the developing-story timeline, related stories, and the primary game's rating
 * summary (for the AggregateRating schema). Returns null when the slug is unknown
 * (the route renders a 404). `internalAssessment` is never selected anywhere here.
 */
export async function getTopicDetail(slug: string): Promise<TopicDetail | null> {
  const [topic] = await db
    .select({
      id: topics.id,
      slug: topics.slug,
      title: topics.title,
      tldr: topics.tldr,
      aiSummary: topics.aiSummary,
      tldrEditorial: tldrEditorialSql,
      summaryEditorial: summaryEditorialSql,
      status: topics.status,
      typeLabel: topicTypes.label,
      distribution: topics.biasDistribution,
      createdAt: topics.createdAt,
      lastActivityAt: topics.lastActivityAt,
    })
    .from(topics)
    .leftJoin(topicTypes, eq(topics.typeId, topicTypes.id))
    .where(eq(topics.slug, slug))
    .limit(1);
  if (!topic || !topic.distribution) return null;
  const topicRules = await rulesSettings();

  const settings = await displaySettings();
  const evidence = await publicIntegrityKinds(settings.integrityAutoPublish);
  const [artRows, gameList, flagTallies, sourceCounts, timelineRows] = await Promise.all([
    db
      .select({
        id: articles.id,
        title: articles.title,
        excerpt: articles.excerpt,
        url: articles.url,
        origin: articles.origin,
        author: articles.author,
        articleType: articles.articleType,
        publishDate: articles.publishDate,
        sourceName: sources.name,
        sourceSlug: sources.slug,
        qualityScore: articles.qualityScore,
        qualityOverride: articles.qualityOverride,
        influenceBreakdown: articles.influenceBreakdown,
        category: articleCategorySql,
      })
      .from(articleTopics)
      .innerJoin(articles, eq(articleTopics.articleId, articles.id))
      .leftJoin(sources, eq(articles.sourceId, sources.id))
      .where(eq(articleTopics.topicId, topic.id))
      .orderBy(desc(articles.publishDate)),
    linkedGamesForTopic(topic.id),
    flagTallyByTopic([topic.id], evidence),
    sourceCountsByTopic([topic.id]),
    db
      .select({
        occurredAt: topicTimelineEvents.occurredAt,
        label: topicTimelineEvents.label,
      })
      .from(topicTimelineEvents)
      .where(eq(topicTimelineEvents.topicId, topic.id))
      .orderBy(asc(topicTimelineEvents.occurredAt))
      .limit(20),
  ]);

  // A real story has at least one article — a zero-article topic (admin/test
  // artifact) is treated as not found rather than rendered as an empty page.
  if (artRows.length === 0) return null;

  const primary = gameList[0] ?? null;
  const [gameRating, relatedPool, relatedCur] = await Promise.all([
    primary ? gameRatingForSubject(primary.subjectId) : Promise.resolve(null),
    primary ? relatedTopicsForGame(primary.subjectId, topic.id) : Promise.resolve([]),
    curationFor('topic', topic.slug, 'related-stories'),
  ]);
  // Phase P S3b: editor pins / excludes + the size rule.
  const related = curateList(
    relatedPool,
    (t) => t.slug,
    relatedCur,
    topicRules.lists.topicRelatedStories,
    await relatedTopicCardsBySlug(relatedCur.pins.filter((x) => x !== topic.slug)),
  );

  const articleRows = await detailRows(
    artRows.map((r) => ({ ...r, category: String(r.category) })),
    settings,
    evidence,
    await categoryContext(),
  );
  const entry = flagTallies.get(topic.id) ?? emptyTopicTally();

  return {
    id: topic.id,
    slug: topic.slug,
    title: topic.title,
    tldr: topic.tldr,
    aiSummary: topic.aiSummary,
    tldrIsAi: Boolean(topic.tldr) && !topic.tldrEditorial,
    summaryIsAi: Boolean(topic.aiSummary) && !topic.summaryEditorial,
    status: topic.status,
    typeLabel: topic.typeLabel,
    publishedAt: topic.createdAt ? topic.createdAt.toISOString() : null,
    lastActivityAt: topic.lastActivityAt ? topic.lastActivityAt.toISOString() : null,
    articleCount: topic.distribution.articleCount,
    sourceCount: sourceCounts.get(topic.id) ?? 0,
    reviewCount: entry.reviews,
    showPanel: topicShowsPanel(settings.displayScope, entry.tally, entry.reviews),
    distribution: publicDistribution(topic.distribution, settings.showQuality),
    flags: entry.tally,
    integrityTally: entry.integrity,
    display: publicDisplay(settings),
    games: gameList.map((g) => ({ name: g.name, slug: g.slug })),
    primaryGame: primary ? { name: primary.name, slug: primary.slug } : null,
    gameRating,
    articles: articleRows,
    timeline: timelineRows.map((t) => ({
      occurredAt: t.occurredAt.toISOString(),
      label: t.label,
    })),
    related,
    // Phase P S4: the indexing rule (sources / summary + game / category) or the editor's setting.
    noindex: !(await isTopicIndexable(topic.id)),
  };
}

// ── game detail (SPEC I5b; BLUEPRINT 2.3 / 3.2) ──────────────────────────────

/**
 * One public rating layer (1–10 display is a frontend concern; we pass the
 * stored 0..100 EFFECTIVE value). `score: null` ⇒ genuinely no data, never 0.
 */
export interface PublicRatingLayer {
  score: number | null;
  count: number | null;
}

/** One media-critic outlet entry ("how others rated" + the review excerpt). */
export interface CriticEntry {
  outlet: string;
  score: number;
  /** e.g. "8/10" when the outlet's native scale is stored; else null. */
  native: string | null;
  excerpt: string | null;
  url: string | null;
}

/** One "across the web" reference (Steam % auto + editor notes), labeled estimate. */
export interface WebRatingEntry {
  label: string;
  score: number | null;
  sentimentPct: number | null;
  sampleSize: number | null;
  isEstimate: boolean;
  note: string | null;
  url: string | null;
}

/**
 * The public, leak-proof rating block. EFFECTIVE values only (override ?? auto),
 * the editor-entered context tag (public-eligible by design), and the VISIBLE
 * burst flag boolean. Deliberately omits the naive score, the raw override
 * values and the burst-info internals (those stay in the admin DTO).
 */
export interface PublicGameRating {
  /** Phase P S5: null while `editorial.teamScore` is off. */
  our: PublicRatingLayer | null;
  critics: PublicRatingLayer;
  community: PublicRatingLayer;
  web: PublicRatingLayer;
  criticEntries: CriticEntry[];
  webEntries: WebRatingEntry[];
  /** Visible "unusual voting activity" flag (never silent suppression). */
  unusualActivity: boolean;
  disconnect: {
    value: number;
    band: DisconnectBand;
    contextTag: string | null;
    ourVsCritics: number | null;
    communityVsWeb: number | null;
  } | null;
}

export interface PublicContentFlags {
  /** null where the value is 'unknown' (the "render only where data" rule). */
  aiAssets: string | null;
  launchState: string | null;
  monetization: {
    microtransactions: boolean;
    battlePass: boolean;
    lootBoxesOrGacha: boolean;
  };
  /** True only when at least one monetization signal is present. */
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

/** An article that mentions the game (excerpt + link only — I1 copyright). */
export type GameArticleRow = TopicArticleRow;

export interface GameVideoEntry {
  provider: string;
  url: string;
  title: string | null;
  /** Channel/author from the provider (A2) — shown on the card. */
  channel: string | null;
  /** Provider thumbnail (A2). Null in demo → the frontend draws its designed cover. */
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
  /** Outbound store page for the DLC (A2) — link out, never scraped content. */
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
  /** Phase P S3b: an editor kept this game page out of search indexes. */
  noindex: boolean;
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
  /** Licensed-cover slot (null in demo — the frontend renders a designed cover). */
  coverUrl: string | null;
  backgroundUrl: string | null;
  /**
   * Public Steam app id (A2) — powers the outbound Steam store + SteamDB
   * "More stats" links. A public fact (it's in every Steam URL), not internal.
   */
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
  /** Phase P S4: this game on confirmed editorial lists ("#3 at IGN" + link out) + comparison lines. */
  editorialLists: GameEditorialLists;
  /** Phase P S5: the published editor note (null = none). Editorial content — no AI label. */
  communityNote: PublicCommunityNote | null;
  /** Phase P S5: the Steam reviews summary (null below the threshold / hidden). */
  steamReviews: PublicSteamSummary | null;
  /** Outlet review articles — their own block, pinned above the news (Phase P S1). */
  reviews: GameArticleRow[];
  /** Other coverage that mentions the game (reviews excluded). */
  articles: GameArticleRow[];
  display: PublicDisplay;
  videos: GameVideoEntry[];
  prices: GamePriceEntry[];
  sysReqs: GameSysReqEntry[];
  dlc: GameDlcEntry[];
  playerCount: GamePlayerCount | null;
  /** Recent Steam player-count history (ascending) for the momentum sparkline. */
  playerCountHistory: PlayerCountPoint[];
  relatedGames: RelatedGame[];
}

/**
 * A licensed cover only renders when it's a real asset. The demo dataset uses
 * `placehold.co` placeholder URLs (and we never scrape an outlet image), so those
 * are treated as "no licensed cover" → the frontend draws its designed cover.
 * A production IGDB/RAWG cover passes straight through with no layout change.
 */
function publicAssetUrl(url: string | null): string | null {
  if (!url) return null;
  if (/placehold\.co|placeholder|example\.com/i.test(url)) return null;
  return url;
}

function nativeScale(score: number | null, max: number | null): string | null {
  if (score == null || max == null || max <= 0) return null;
  // Trim a trailing ".0" so "8.0/10" reads "8/10".
  const s = Number.isInteger(score) ? String(score) : String(score);
  return `${s}/${max}`;
}

async function criticEntriesFor(gameId: string): Promise<CriticEntry[]> {
  const rows = await db
    .select({
      outlet: gameCriticReviews.outletName,
      score: gameCriticReviews.score,
      nativeScore: gameCriticReviews.nativeScore,
      nativeScaleMax: gameCriticReviews.nativeScaleMax,
      excerpt: gameCriticReviews.excerpt,
      url: gameCriticReviews.url,
    })
    .from(gameCriticReviews)
    .where(eq(gameCriticReviews.gameId, gameId))
    .orderBy(desc(gameCriticReviews.score));
  return rows.map((r) => ({
    outlet: r.outlet,
    score: r.score,
    native: nativeScale(r.nativeScore, r.nativeScaleMax),
    excerpt: r.excerpt,
    url: r.url,
  }));
}

async function webRatingsFor(gameId: string): Promise<WebRatingEntry[]> {
  const rows = await db
    .select({
      label: gameExternalRatings.label,
      score: gameExternalRatings.score,
      sentimentPct: gameExternalRatings.sentimentPct,
      sampleSize: gameExternalRatings.sampleSize,
      isEstimate: gameExternalRatings.isEstimate,
      note: gameExternalRatings.note,
      url: gameExternalRatings.url,
    })
    .from(gameExternalRatings)
    .where(eq(gameExternalRatings.gameId, gameId))
    .orderBy(desc(gameExternalRatings.capturedAt));
  return rows.map((r) => ({
    label: r.label,
    score: r.score ?? null,
    sentimentPct: r.sentimentPct ?? null,
    sampleSize: r.sampleSize ?? null,
    isEstimate: r.isEstimate,
    note: r.note ?? null,
    url: r.url ?? null,
  }));
}

/** Content flags, leak-proof + "render only where data" ('unknown' → null). */
async function contentFlagsFor(gameId: string): Promise<PublicContentFlags | null> {
  const [row] = await db
    .select()
    .from(gameContentFlags)
    .where(eq(gameContentFlags.gameId, gameId))
    .limit(1);
  if (!row) return null;
  const monetization = {
    microtransactions: row.hasMicrotransactions,
    battlePass: row.hasBattlePass,
    lootBoxesOrGacha: row.hasLootBoxesOrGacha,
    // "predatory monetization" is no longer a content flag — it became the
    // Pay-to-win ISSUE tag (owner, S3), shown in the Issues group with provenance.
  };
  const hasMonetization = Object.values(monetization).some(Boolean);
  return {
    aiAssets: row.aiAssets === 'unknown' ? null : row.aiAssets,
    launchState: row.launchState === 'unknown' ? null : row.launchState,
    monetization,
    hasMonetization,
    complexity: row.complexityRating ?? null,
    notes: row.notes ?? null,
  };
}

async function ourReviewFor(gameId: string): Promise<PublicReview | null> {
  const [r] = await db
    .select({
      verdict: gameReviews.verdict,
      pros: gameReviews.pros,
      cons: gameReviews.cons,
      platformTested: gameReviews.platformTested,
      hoursPlayed: gameReviews.hoursPlayed,
      body: gameReviews.body,
      ourScore: gameReviews.ourScore,
      publishedAt: gameReviews.publishedAt,
      author: users.displayName,
    })
    .from(gameReviews)
    .leftJoin(users, eq(gameReviews.authorUserId, users.id))
    .where(eq(gameReviews.gameId, gameId))
    .limit(1);
  if (!r) return null;
  // Phase P S5: the text stays; the score follows `teamScore`, the verdict `teamVerdict`.
  const ed = (await rulesSettings()).editorial;
  const score = teamOnly(ed.teamScore, r.ourScore);
  const verdict = ed.teamVerdict ? (r.verdict ?? null) : null;
  // Nothing public left (a score / verdict-only review with both switched off) → no block.
  if (
    score == null &&
    !verdict &&
    !r.body?.trim() &&
    !(r.pros ?? []).length &&
    !(r.cons ?? []).length
  ) {
    return null;
  }
  return {
    verdict,
    pros: r.pros ?? [],
    cons: r.cons ?? [],
    platformTested: r.platformTested ?? null,
    hoursPlayed: r.hoursPlayed ?? null,
    body: r.body ?? null,
    ourScore: score,
    author: r.author ?? null,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
  };
}

/**
 * Articles that mention this game (excerpt + link only), split for the page:
 * `reviews` (review articles — their own block, pinned above the news) and
 * `news` (everything else). Each list is capped separately.
 */
async function articlesForGame(
  subjectId: string,
  settings: DisplaySettings,
  evidence: IntegrityEvidence,
  limit = 12,
): Promise<{ reviews: GameArticleRow[]; news: GameArticleRow[] }> {
  const query = (reviewsOnly: boolean) =>
    db
      .select({
        id: articles.id,
        title: articles.title,
        excerpt: articles.excerpt,
        url: articles.url,
        origin: articles.origin,
        author: articles.author,
        articleType: articles.articleType,
        publishDate: articles.publishDate,
        sourceName: sources.name,
        sourceSlug: sources.slug,
        qualityScore: articles.qualityScore,
        qualityOverride: articles.qualityOverride,
        influenceBreakdown: articles.influenceBreakdown,
        category: articleCategorySql,
      })
      .from(articleSubjects)
      .innerJoin(articles, eq(articleSubjects.articleId, articles.id))
      .leftJoin(sources, eq(articles.sourceId, sources.id))
      .where(
        and(
          eq(articleSubjects.subjectId, subjectId),
          reviewsOnly ? eq(articles.articleType, 'review') : ne(articles.articleType, 'review'),
          // Phase P S4 (owner): "hide" drops; "low" stays with a category chip.
          notInCategories(articleCategorySql, cats.hide),
        ),
      )
      .orderBy(desc(articles.publishDate))
      .limit(limit);
  const cats = await categoryContext();
  const [reviewRows, newsRows] = await Promise.all([query(true), query(false)]);
  const asInput = (rows: Awaited<ReturnType<typeof query>>) =>
    rows.map((r) => ({ ...r, category: String(r.category) }));
  const [reviews, news] = await Promise.all([
    detailRows(asInput(reviewRows), settings, evidence, cats),
    detailRows(asInput(newsRows), settings, evidence, cats),
  ]);
  return { reviews, news };
}

/** Topics that mention this game — the news↔ratings bridge (graceful: []). */
async function relatedTopicsForGameSubject(subjectId: string): Promise<RelatedTopic[]> {
  const idRows = await db
    .selectDistinct({ topicId: articleTopics.topicId })
    .from(articleTopics)
    .innerJoin(articleSubjects, eq(articleSubjects.articleId, articleTopics.articleId))
    .where(eq(articleSubjects.subjectId, subjectId))
    .limit(48);
  const ids = idRows.map((r) => r.topicId);
  if (ids.length === 0) return [];
  const [rows, sourceCounts] = await Promise.all([
    db
      .select({
        id: topics.id,
        slug: topics.slug,
        title: topics.title,
        distribution: topics.biasDistribution,
        lastActivityAt: topics.lastActivityAt,
      })
      .from(topics)
      .where(
        and(
          inArray(topics.id, ids),
          isNotNull(topics.biasDistribution),
          // Phase P S4: stories in a "hide" category are not offered as related.
          notInCategories(topicCategorySql, (await categoryContext()).hide),
        ),
      ),
    sourceCountsByTopic(ids),
  ]);
  return rows
    .filter((t) => (t.distribution?.articleCount ?? 0) > 0)
    .map((t) => ({
      slug: t.slug,
      title: t.title,
      articleCount: t.distribution?.articleCount ?? 0,
      sourceCount: sourceCounts.get(t.id) ?? 0,
      activity: t.lastActivityAt ? t.lastActivityAt.getTime() : 0,
    }))
    .sort((a, b) => b.activity - a.activity)
    .map(({ slug, title, articleCount, sourceCount }) => ({
      slug,
      title,
      articleCount,
      sourceCount,
    }));
}

/** Related games by shared series → shared genre (discovery; excludes self). */
async function relatedGamesFor(
  gameId: string,
  series: string | null,
  genres: string[] | null,
): Promise<RelatedGame[]> {
  const conds = [];
  if (series) conds.push(eq(games.series, series));
  if (genres && genres.length > 0) conds.push(arrayOverlaps(games.genres, genres));
  if (conds.length === 0) return [];
  const rows = await db
    .select({
      slug: subjects.slug,
      name: subjects.name,
      genres: games.genres,
      series: games.series,
      our: gameRatingSummaries.ourScore,
      criticsAuto: gameRatingSummaries.criticsScore,
      criticsOverride: gameRatingSummaries.criticsOverride,
      communityAuto: gameRatingSummaries.communityOurScore,
      communityOverride: gameRatingSummaries.communityOverride,
    })
    .from(games)
    .innerJoin(subjects, eq(games.subjectId, subjects.id))
    .leftJoin(gameRatingSummaries, eq(gameRatingSummaries.gameId, games.id))
    .where(and(ne(games.id, gameId), or(...conds)))
    .limit(48);
  // Prefer same-series, then rated, then alphabetical — keep it to a tidy 6.
  const team = await teamScoreOn();
  return rows
    .map((r) => ({
      slug: r.slug,
      name: r.name,
      genres: r.genres ?? [],
      our: teamOnly(team, r.our),
      critics: effective(r.criticsAuto, r.criticsOverride),
      community: effective(r.communityAuto, r.communityOverride),
      sameSeries: series != null && r.series === series,
    }))
    .sort(
      (a, b) =>
        Number(b.sameSeries) - Number(a.sameSeries) ||
        // Phase P S5: critics, then community — our score never orders anything.
        (b.critics ?? b.community ?? -1) - (a.critics ?? a.community ?? -1),
    )
    .map(({ slug, name, genres: g, our, critics, community }) => ({
      slug,
      name,
      genres: g,
      our,
      critics,
      community,
    }));
}

/**
 * Full game-page payload for `/games/[slug]` (leak-proof; pre-computed). Returns
 * null when the slug is unknown (the route renders a 404). Selects an explicit
 * allowlist — the internal-only rating internals (naive score, raw overrides,
 * burst-info math, `internal_assessment`) are never referenced here.
 */
export async function getGameDetail(slug: string): Promise<GameDetail | null> {
  const gameRules = await rulesSettings();
  const [g] = await db
    .select({
      gameId: games.id,
      noindex: games.noindex,
      subjectId: games.subjectId,
      name: subjects.name,
      slug: subjects.slug,
      summary: games.summary,
      description: games.description,
      status: games.status,
      releaseDate: games.releaseDate,
      developer: games.developer,
      publisher: games.publisher,
      engine: games.engine,
      ageRatingSystem: games.ageRatingSystem,
      ageRatingValue: games.ageRatingValue,
      series: games.series,
      mode: games.mode,
      genres: games.genres,
      platforms: games.platforms,
      tags: games.tags,
      coverUrl: games.coverUrl,
      backgroundUrl: games.backgroundUrl,
      steamAppId: games.steamAppId,
      hltbMainHours: games.hltbMainHours,
      hltbCompletionistHours: games.hltbCompletionistHours,
      steamCompletionRate: games.steamCompletionRate,
    })
    .from(games)
    .innerJoin(subjects, and(eq(games.subjectId, subjects.id), eq(subjects.type, 'game')))
    .where(eq(subjects.slug, slug))
    .limit(1);
  if (!g) return null;

  const settings = await displaySettings();
  const evidence = await publicIntegrityKinds(settings.integrityAutoPublish);
  const [summary] = await db
    .select()
    .from(gameRatingSummaries)
    .where(eq(gameRatingSummaries.gameId, g.gameId))
    .limit(1);

  const [
    criticEntries,
    webEntries,
    contentFlags,
    review,
    relatedTopics,
    gameArticles,
    relatedGames,
    videoRows,
    priceRows,
    sysReqRows,
    dlcRows,
    playerRows,
    communityCount,
    tagGroupMap,
  ] = await Promise.all([
    criticEntriesFor(g.gameId),
    webRatingsFor(g.gameId),
    contentFlagsFor(g.gameId),
    ourReviewFor(g.gameId),
    relatedTopicsForGameSubject(g.subjectId).then(async (pool) => {
      const cur = await curationFor('game', g.slug, 'related-stories');
      return curateList(
        pool,
        (t) => t.slug,
        cur,
        gameRules.lists.gameRelatedStories,
        await relatedTopicCardsBySlug(cur.pins),
      );
    }),
    articlesForGame(g.subjectId, settings, evidence),
    relatedGamesFor(g.gameId, g.series, g.genres).then(async (pool) => {
      const cur = await curationFor('game', g.slug, 'related-games');
      return curateList(
        pool,
        (x) => x.slug,
        cur,
        gameRules.lists.gameRelatedGames,
        await relatedGameCardsBySlug(cur.pins.filter((x) => x !== g.slug)),
      );
    }),
    db
      .select({
        provider: gameVideos.provider,
        url: gameVideos.videoUrl,
        title: gameVideos.title,
        channel: gameVideos.channel,
        thumbnailUrl: gameVideos.thumbnailUrl,
        kind: gameVideos.kind,
        isLive: gameVideos.isLive,
        isPinned: gameVideos.isPinned,
        sort: gameVideos.sort,
      })
      .from(gameVideos)
      .where(eq(gameVideos.gameId, g.gameId))
      // A2 display rule: editor-pinned first, then sort order; how many is a rule (S3b).
      .orderBy(desc(gameVideos.isPinned), asc(gameVideos.sort))
      .limit(gameRules.lists.gameVideos),
    db
      .select({
        store: gamePrices.store,
        platform: gamePrices.platform,
        priceCents: gamePrices.priceCents,
        discountPct: gamePrices.discountPct,
        isOnSale: gamePrices.isOnSale,
        currency: gamePrices.currency,
        url: gamePrices.url,
      })
      .from(gamePrices)
      .where(eq(gamePrices.gameId, g.gameId))
      .orderBy(asc(gamePrices.priceCents)),
    db
      .select({
        kind: gameSystemRequirements.kind,
        platform: gameSystemRequirements.platform,
        os: gameSystemRequirements.os,
        cpu: gameSystemRequirements.cpu,
        gpu: gameSystemRequirements.gpu,
        ramGb: gameSystemRequirements.ramGb,
        storageGb: gameSystemRequirements.storageGb,
      })
      .from(gameSystemRequirements)
      .where(eq(gameSystemRequirements.gameId, g.gameId)),
    db
      .select({
        name: gameDlc.name,
        priceCents: gameDlc.priceCents,
        currency: gameDlc.currency,
        releaseDate: gameDlc.releaseDate,
        url: gameDlc.url,
      })
      .from(gameDlc)
      .where(eq(gameDlc.gameId, g.gameId)),
    // B2 chart: ONE point per week over ~6 months (the latest sample of each
    // 7-day bucket, counted back from the newest) — the sampling cadence (daily
    // since Phase P S2, admin-set) never changes the chart's shape or cost.
    weeklyPlayerHistory(g.gameId),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(gameUserRatings)
      .where(eq(gameUserRatings.gameId, g.gameId)),
    publicTagGroups([g.gameId]),
  ]);

  // ── shape the leak-proof rating block (effective values only) ───────────────
  let rating: PublicGameRating | null = null;
  if (summary) {
    // Phase P S5: our score only with `teamScore` on — its own layer, never an aggregate.
    const team = await teamScoreOn();
    const our = teamOnly(team, summary.ourScore);
    const critics = effective(summary.criticsScore, summary.criticsOverride);
    const community = effective(summary.communityOurScore, summary.communityOverride);
    const web = summary.communityWebScore ?? null;
    const hasAny =
      our != null ||
      critics != null ||
      community != null ||
      web != null ||
      criticEntries.length > 0 ||
      webEntries.length > 0;
    if (hasAny) {
      const unusualActivity = summary.burstFlagOverride ?? summary.communityBurstFlag;
      rating = {
        our: team ? { score: our, count: null } : null,
        critics: { score: critics, count: summary.criticsOutletCount ?? criticEntries.length },
        community: {
          score: community,
          count: summary.communityOurCount ?? communityCount[0]?.n ?? 0,
        },
        web: { score: web, count: null },
        criticEntries,
        webEntries,
        unusualActivity,
        disconnect:
          summary.disconnectValue != null && summary.disconnectBand
            ? {
                value: summary.disconnectValue,
                band: summary.disconnectBand as DisconnectBand,
                contextTag: summary.disconnectContextTag ?? null,
                ourVsCritics: team ? (summary.disconnectDetail?.ourVsCritics ?? null) : null,
                communityVsWeb: summary.disconnectDetail?.communityVsWeb ?? null,
              }
            : null,
      };
    }
  }

  const player = playerRows[0];
  const [recordedPeak, editorialLists, communityNote, steamReviews] = await Promise.all([
    recordedPlayerPeak(g.gameId),
    // Phase P S4: positions on confirmed lists + comparison lines (never a full list).
    gameEditorialLists(g.gameId, g.slug),
    // Phase P S5: "What the community says" — the editor note + the Steam reviews summary.
    publicCommunityNote(g.gameId),
    publicSteamSummary(g.gameId, g.steamAppId ?? null),
  ]);

  return {
    editorialLists,
    communityNote,
    steamReviews,
    noindex: g.noindex,
    id: g.gameId, // I6 Slice 8: the community write components address the game by id
    slug: g.slug,
    name: g.name,
    summary: g.summary ?? null,
    description: g.description ?? null,
    status: g.status,
    releaseDate: g.releaseDate ?? null,
    developer: g.developer ?? null,
    publisher: g.publisher ?? null,
    engine: g.engine ?? null,
    ageRatingSystem: g.ageRatingSystem ?? null,
    ageRatingValue: g.ageRatingValue ?? null,
    series: g.series ?? null,
    mode: g.mode ?? [],
    genres: g.genres ?? [],
    platforms: g.platforms ?? [],
    tags: g.tags ?? [],
    coverUrl: publicAssetUrl(g.coverUrl),
    backgroundUrl: publicAssetUrl(g.backgroundUrl),
    steamAppId: g.steamAppId ?? null,
    hltbMainHours: g.hltbMainHours ?? null,
    hltbCompletionistHours: g.hltbCompletionistHours ?? null,
    steamCompletionRate: g.steamCompletionRate ?? null,
    rating,
    contentFlags,
    tagGroups: tagGroupMap.get(g.gameId) ?? { content: [], issues: [] },
    review,
    relatedTopics,
    reviews: gameArticles.reviews,
    articles: gameArticles.news,
    display: publicDisplay(settings),
    videos: videoRows.map((v) => ({
      provider: v.provider,
      url: v.url,
      title: v.title ?? null,
      channel: v.channel ?? null,
      thumbnailUrl: publicAssetUrl(v.thumbnailUrl),
      kind: v.kind,
      isLive: v.isLive,
    })),
    prices: priceRows.map((p) => ({
      store: p.store,
      platform: p.platform ?? null,
      priceCents: p.priceCents,
      discountPct: p.discountPct,
      isOnSale: p.isOnSale,
      currency: p.currency,
      url: p.url ?? null,
    })),
    sysReqs: sysReqRows.map((s) => ({
      kind: s.kind,
      platform: s.platform,
      os: s.os ?? null,
      cpu: s.cpu ?? null,
      gpu: s.gpu ?? null,
      ramGb: s.ramGb ?? null,
      storageGb: s.storageGb ?? null,
    })),
    dlc: dlcRows.map((d) => ({
      name: d.name,
      priceCents: d.priceCents ?? null,
      currency: d.currency,
      releaseDate: d.releaseDate ?? null,
      url: d.url ?? null,
    })),
    playerCount: player
      ? {
          current: player.current ?? null,
          // "Peak (recorded)": the highest number in the WHOLE recorded history.
          peak: recordedPeak ?? player.peak ?? null,
          capturedAt: player.capturedAt.toISOString(),
        }
      : null,
    // Oldest → newest for the momentum sparkline (the query is newest-first).
    playerCountHistory: [...playerRows]
      .reverse()
      .map((p) => ({ capturedAt: p.capturedAt.toISOString(), current: p.current ?? null })),
    relatedGames,
  };
}

/** Rows of a raw `db.execute` result (the driver returns an array or { rows }). */
function execRows<T>(res: unknown): T[] {
  const raw = res as { rows?: T[] } | T[];
  return Array.isArray(raw) ? raw : (raw.rows ?? []);
}

/** Newest-first weekly buckets of a game's player counts (≤ 27 rows, ~6 months). */
async function weeklyPlayerHistory(
  gameId: string,
): Promise<{ current: number | null; peak: number | null; capturedAt: Date }[]> {
  const res = await db.execute(sql`
    WITH newest AS (
      SELECT max(captured_at) AS m FROM game_player_counts WHERE game_id = ${gameId}
    ), b AS (
      SELECT floor(extract(epoch FROM (n.m - p.captured_at)) / 604800)::int AS bucket,
             p.captured_at, p.current_players, p.peak_players
      FROM game_player_counts p, newest n
      WHERE p.game_id = ${gameId} AND p.captured_at > n.m - interval '189 days'
    )
    SELECT DISTINCT ON (bucket) bucket, captured_at, current_players, peak_players
    FROM b ORDER BY bucket ASC, captured_at DESC
  `);
  const rows = execRows<{
    captured_at: string | Date;
    current_players: number | null;
    peak_players: number | null;
  }>(res);
  return rows
    .map((r) => ({
      current: r.current_players == null ? null : Number(r.current_players),
      peak: r.peak_players == null ? null : Number(r.peak_players),
      capturedAt: r.captured_at instanceof Date ? r.captured_at : new Date(r.captured_at),
    }))
    .filter((r) => Number.isFinite(r.capturedAt.getTime()));
}

/** The highest player count ever recorded for a game (current or stored peak). */
async function recordedPlayerPeak(gameId: string): Promise<number | null> {
  const [row] = await db
    .select({
      peak: sql<
        number | null
      >`max(greatest(coalesce(${gamePlayerCounts.currentPlayers}, 0), coalesce(${gamePlayerCounts.peakPlayers}, 0)))`,
    })
    .from(gamePlayerCounts)
    .where(eq(gamePlayerCounts.gameId, gameId));
  const n = row?.peak == null ? null : Number(row.peak);
  return n != null && Number.isFinite(n) && n > 0 ? n : null;
}

// ── catalog / browse (SPEC I5b; BLUEPRINT 2.4) ───────────────────────────────

/** One game as a catalog tile — identity + the three separated scores + the gap. */
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
  disconnectBand: DisconnectBand | null;
  /** Card tags (Phase P S3): content, then CURRENT issues — `tags.catalogCardCount`. */
  tags: CardTag[];
}

/** A filter option with how many catalog games carry it. */
export interface CatalogFacet {
  value: string;
  count: number;
}

export interface CatalogFilters {
  genre?: string | null;
  platform?: string | null;
  sort?: string | null;
  /** 1-based page (A1). Out-of-range values clamp into [1..totalPages]. */
  page?: number | null;
  /** Phase P S3: games must carry EVERY included published tag … */
  tags?: string[] | null;
  /** … and NONE of the excluded ones. */
  xtags?: string[] | null;
}

export interface CatalogData {
  games: CatalogGame[];
  total: number;
  /** Total catalog size (before filtering) — the "X of Y games" readout. */
  catalogTotal: number;
  genres: CatalogFacet[];
  platforms: CatalogFacet[];
  /** Published tags with their game counts (tri-state chips). */
  tagFacets: TagFacet[];
  /** Echoes the APPLIED filters (normalized) so the page can mark them active. */
  applied: {
    genre: string | null;
    platform: string | null;
    sort: string;
    tags: string[];
    xtags: string[];
  };
  /** Server-side pagination (A1): `games` is THIS page's slice, never the full set. */
  page: number;
  perPage: number;
  totalPages: number;
}

const CATALOG_SORTS = new Set(['rating', 'name', 'newest']);

/**
 * Games per catalog page (A1). Admin-tunable via the `catalog` app_setting
 * (`{ pageSize }`), like the clustering knobs — nothing hardcoded; 36 is only
 * the fallback when the setting is absent/invalid.
 */
const CATALOG_PAGE_SIZE_DEFAULT = 36;
async function catalogPageSize(): Promise<number> {
  try {
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, 'catalog'))
      .limit(1);
    const n = row?.value?.pageSize;
    if (typeof n === 'number' && Number.isInteger(n) && n >= 6 && n <= 500) return n;
  } catch {
    /* fall through to the default */
  }
  return CATALOG_PAGE_SIZE_DEFAULT;
}

function facetTally(values: string[]): CatalogFacet[] {
  const map = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    map.set(v, (map.get(v) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function normFilter(v: string | null | undefined): string | null {
  const s = (v ?? '').trim().toLowerCase();
  return s.length > 0 ? s : null;
}

/** Combined display strength (critics + our + community, where present). */
/**
 * Ranking strength for "Top rated" lists and the rating sort: the critic +
 * community layers only (owner decision, applied with Phase P S2 — the team score
 * stays out of every Top Rated ranking until S5 switches it on).
 */
function catalogStrength(g: CatalogGame): number {
  const parts = [g.critics, g.community].filter((n): n is number => n != null);
  if (parts.length === 0) return -1;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

function sortCatalog(list: CatalogGame[], sort: string): CatalogGame[] {
  const arr = [...list];
  if (sort === 'name') return arr.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === 'newest')
    return arr.sort(
      (a, b) =>
        (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '') || a.name.localeCompare(b.name),
    );
  // rating (default) — strongest first, unscored last, alphabetical tiebreak.
  return arr.sort(
    (a, b) => catalogStrength(b) - catalogStrength(a) || a.name.localeCompare(b.name),
  );
}

/** The whole catalog as leak-proof CatalogGame rows (shared by browse + discovery). */
async function loadCatalogRows(): Promise<CatalogGame[]> {
  const rows = await db
    .select({
      gameId: games.id,
      slug: subjects.slug,
      name: subjects.name,
      status: games.status,
      releaseDate: games.releaseDate,
      genres: games.genres,
      platforms: games.platforms,
      coverUrl: games.coverUrl,
      our: gameRatingSummaries.ourScore,
      criticsAuto: gameRatingSummaries.criticsScore,
      criticsOverride: gameRatingSummaries.criticsOverride,
      communityAuto: gameRatingSummaries.communityOurScore,
      communityOverride: gameRatingSummaries.communityOverride,
      disconnectValue: gameRatingSummaries.disconnectValue,
      disconnectBand: gameRatingSummaries.disconnectBand,
    })
    .from(games)
    .innerJoin(subjects, and(eq(games.subjectId, subjects.id), eq(subjects.type, 'game')))
    .leftJoin(gameRatingSummaries, eq(gameRatingSummaries.gameId, games.id));

  const [groups, { catalogCardCount }] = await Promise.all([
    publicTagGroups(rows.map((r) => r.gameId)),
    tagSettings(),
  ]);
  const team = await teamScoreOn();
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    status: r.status,
    releaseDate: r.releaseDate ?? null,
    genres: r.genres ?? [],
    platforms: r.platforms ?? [],
    coverUrl: publicAssetUrl(r.coverUrl),
    our: teamOnly(team, r.our),
    critics: effective(r.criticsAuto, r.criticsOverride),
    community: effective(r.communityAuto, r.communityOverride),
    disconnectValue: r.disconnectValue ?? null,
    disconnectBand: (r.disconnectBand as DisconnectBand) ?? null,
    tags: cardTags(groups.get(r.gameId), ['content', 'issue'], catalogCardCount),
  }));
}

/** Tag slugs from a query: lowercase slug charset only, de-duplicated, at most 10. */
const TAG_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function normTagList(v: string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of v ?? []) {
    for (const part of String(raw).split(',')) {
      const t = part.trim().toLowerCase();
      if (t && t.length <= 160 && TAG_SLUG_RE.test(t) && !out.includes(t)) out.push(t);
    }
  }
  return out.slice(0, 10);
}

/**
 * The browsable catalog (SPEC I5b; paginated in A1). Reads the whole catalog once
 * (bounded, no per-request heavy work), derives the genre/platform facets from it,
 * applies the requested filter + sort, then returns ONE page slice — the full set
 * is never shipped in one response (production has thousands of games). Effective
 * scores only (override ?? auto); the internal rating internals are never selected.
 */
export async function getCatalogData(filters: CatalogFilters = {}): Promise<CatalogData> {
  const all = await loadCatalogRows();

  // Facets are derived from the FULL catalog so the option list is stable.
  const genres = facetTally(all.flatMap((g) => g.genres));
  const platforms = facetTally(all.flatMap((g) => g.platforms));

  const genre = normFilter(filters.genre);
  const platform = normFilter(filters.platform);
  // Phase P S3: tri-state tag filters. A slug in both lists counts as excluded.
  const xtags = normTagList(filters.xtags);
  const tagsIn = normTagList(filters.tags).filter((t) => !xtags.includes(t));
  let filtered = all;
  if (genre) filtered = filtered.filter((g) => g.genres.some((x) => x.toLowerCase() === genre));
  if (platform)
    filtered = filtered.filter((g) => g.platforms.some((x) => x.toLowerCase() === platform));
  if (tagsIn.length || xtags.length) {
    const sets = await gameSlugsByTag([...tagsIn, ...xtags]);
    filtered = filtered.filter(
      (g) =>
        tagsIn.every((t) => sets.get(t)?.has(g.slug)) &&
        !xtags.some((t) => sets.get(t)?.has(g.slug)),
    );
  }

  const sort = CATALOG_SORTS.has(filters.sort ?? '') ? (filters.sort as string) : 'rating';
  const sorted = sortCatalog(filtered, sort);

  // Server-side pagination (A1). Malformed pages coerce to 1; out-of-range pages
  // clamp to the last real page — a crawler or hand-typed URL never gets a
  // broken/empty page when games exist.
  const perPage = await catalogPageSize();
  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
  const requested =
    typeof filters.page === 'number' && Number.isFinite(filters.page)
      ? Math.trunc(filters.page)
      : 1;
  const page = Math.min(totalPages, Math.max(1, requested));
  const start = (page - 1) * perPage;

  return {
    games: sorted.slice(start, start + perPage),
    total: sorted.length,
    catalogTotal: all.length,
    genres,
    platforms,
    tagFacets: await tagFacets(),
    applied: { genre, platform, sort, tags: tagsIn, xtags },
    page,
    perPage,
    totalPages,
  };
}

// ── tag pages (Phase P S3) ────────────────────────────────────────────────────
export interface TagPageData {
  tag: { slug: string; name: string; family: string; intro: string | null };
  games: CatalogGame[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  /** Indexable (and in the sitemap) only with ≥ `tags.indexMinGames` published games. */
  indexable: boolean;
  indexMinGames: number;
}

/** /games/tag/[slug]: the published games carrying an ACTIVE tag (null → 404). */
export async function getTagPageData(
  slug: string,
  page: number | null,
): Promise<TagPageData | null> {
  if (!TAG_SLUG_RE.test(slug)) return null;
  const tag = await publicTag(slug);
  if (!tag) return null;
  const [all, sets, settings, perPage] = await Promise.all([
    loadCatalogRows(),
    gameSlugsByTag([slug]),
    tagSettings(),
    catalogPageSize(),
  ]);
  const members = sets.get(slug) ?? new Set<string>();
  const list = sortCatalog(
    all.filter((g) => members.has(g.slug)),
    'rating',
  );
  const totalPages = Math.max(1, Math.ceil(list.length / perPage));
  const requested = typeof page === 'number' && Number.isFinite(page) ? Math.trunc(page) : 1;
  const current = Math.min(totalPages, Math.max(1, requested));
  return {
    tag,
    games: list.slice((current - 1) * perPage, current * perPage),
    total: list.length,
    page: current,
    perPage,
    totalPages,
    indexable: list.length >= settings.indexMinGames,
    indexMinGames: settings.indexMinGames,
  };
}

export { sitemapTags as getSitemapTags };

// ── quick view (Phase P S3) ───────────────────────────────────────────────────
export interface QuickViewData {
  slug: string;
  name: string;
  coverUrl: string | null;
  /** The public rating layers, effective values (override ?? auto), 0..100. */
  layers: { critics: number | null; our: number | null; community: number | null };
  disconnect: { value: number | null; band: string | null };
  tags: { content: CardTag[]; issues: CardTag[] };
  /** Steam only (no public console counts) — current + Δ over the By-players window. */
  players: {
    current: number | null;
    capturedAt: string;
    delta: Delta | null;
    windowHours: number;
  } | null;
}

/** The quick-view payload — built from stored summaries + samples, cached in Redis. */
export async function getQuickView(
  slug: string,
): Promise<{ data: QuickViewData; cache: 'hit' | 'miss' | 'off' } | null> {
  if (!TAG_SLUG_RE.test(slug)) return null;
  const { quickViewCacheSeconds } = await tagSettings();
  const team = await teamScoreOn();
  // Phase P S5: the team-score switch is part of the key (a toggle applies at once).
  const key = `gk:quickview:v1:${team ? 't' : 'f'}:${slug}`;
  if (quickViewCacheSeconds > 0) {
    try {
      const hit = await redis.get(key);
      if (hit) return { data: JSON.parse(hit) as QuickViewData, cache: 'hit' };
    } catch {
      /* cache unavailable — compute */
    }
  }
  const [g] = await db
    .select({
      gameId: games.id,
      slug: subjects.slug,
      name: subjects.name,
      coverUrl: games.coverUrl,
      our: gameRatingSummaries.ourScore,
      criticsAuto: gameRatingSummaries.criticsScore,
      criticsOverride: gameRatingSummaries.criticsOverride,
      communityAuto: gameRatingSummaries.communityOurScore,
      communityOverride: gameRatingSummaries.communityOverride,
      disconnectValue: gameRatingSummaries.disconnectValue,
      disconnectBand: gameRatingSummaries.disconnectBand,
    })
    .from(games)
    .innerJoin(subjects, and(eq(games.subjectId, subjects.id), eq(subjects.type, 'game')))
    .leftJoin(gameRatingSummaries, eq(gameRatingSummaries.gameId, games.id))
    .where(eq(subjects.slug, slug))
    .limit(1);
  if (!g) return null;
  const [groupMap, byPlayers, hp] = await Promise.all([
    publicTagGroups([g.gameId]),
    sectionByKey('by_players'),
    homepageSettings(),
  ]);
  const groups = groupMap.get(g.gameId);
  const windowHours = byPlayers?.deltaWindowHours ?? 168;
  const since = new Date(Date.now() - 2 * windowHours * 3_600_000);
  const samples = await db
    .select({ current: gamePlayerCounts.currentPlayers, at: gamePlayerCounts.capturedAt })
    .from(gamePlayerCounts)
    .where(
      and(eq(gamePlayerCounts.gameId, g.gameId), sql`${gamePlayerCounts.capturedAt} >= ${since}`),
    )
    .orderBy(desc(gamePlayerCounts.capturedAt));
  const cut = Date.now() - windowHours * 3_600_000;
  const nowS = samples
    .filter((x) => x.at.getTime() > cut && x.current != null)
    .map((x) => x.current!);
  const prevS = samples
    .filter((x) => x.at.getTime() <= cut && x.current != null)
    .map((x) => x.current!);
  const latest = samples[0];
  const data: QuickViewData = {
    slug: g.slug,
    name: g.name,
    coverUrl: publicAssetUrl(g.coverUrl),
    layers: {
      critics: effective(g.criticsAuto, g.criticsOverride),
      our: teamOnly(team, g.our),
      community: effective(g.communityAuto, g.communityOverride),
    },
    disconnect: { value: g.disconnectValue ?? null, band: g.disconnectBand ?? null },
    tags: {
      content: cardTags(groups, ['content'], 50),
      issues: cardTags(groups, ['issue'], 50),
    },
    players: latest
      ? {
          current: latest.current ?? null,
          capturedAt: latest.at.toISOString(),
          delta: playersDelta(nowS, prevS, hp.deltaMinPoints),
          windowHours,
        }
      : null,
  };
  if (quickViewCacheSeconds > 0) {
    try {
      await redis.set(key, JSON.stringify(data), 'EX', quickViewCacheSeconds);
    } catch {
      /* best-effort */
    }
  }
  return { data, cache: quickViewCacheSeconds > 0 ? 'miss' : 'off' };
}

// ── discovery (A1) — the curated /games entry (Steam/IMDb model) ─────────────

/** A most-discussed entry: a catalog game + how much coverage it's drawing. */
export interface MostDiscussedGame extends CatalogGame {
  articleCount: number;
  sourceCount: number;
}

export interface DiscoveryData {
  /** Full catalog size — powers the "Browse all N games →" CTA. */
  catalogTotal: number;
  topRated: CatalogGame[];
  /** Games drawing the most coverage across outlets (article + outlet counts). */
  mostDiscussed: MostDiscussedGame[];
  genres: CatalogFacet[];
  comingSoon: UpcomingGame[];
}

/**
 * The /games discovery page (A1). Big catalogs lead with curation and only show
 * the exhaustive grid when asked (→ /games/browse), so this reuses the same
 * pre-computed rows as the catalog plus one coverage aggregate — same leak-proof
 * surface, nothing recomputes on request.
 */
export async function getDiscoveryData(): Promise<DiscoveryData> {
  const all = await loadCatalogRows();
  // Phase P S3b: rail sizes are rules; each rail takes editor pins / excludes.
  const discoveryRules = (await rulesSettings()).lists;
  const [curTop, curDiscussed, curSoon] = await Promise.all([
    curationFor('discovery', 'main', 'top-rated'),
    curationFor('discovery', 'main', 'most-discussed'),
    curationFor('discovery', 'main', 'coming-soon'),
  ]);
  const bySlug = new Map(all.map((g) => [g.slug, g]));

  // Coverage counts per game across the aggregated feed (facts, not a score).
  const discussedRows = await db
    .select({
      slug: subjects.slug,
      articleCount: sql<number>`count(distinct ${articles.id})`,
      sourceCount: sql<number>`count(distinct ${articles.sourceId})`,
    })
    .from(articleSubjects)
    .innerJoin(subjects, and(eq(subjects.id, articleSubjects.subjectId), eq(subjects.type, 'game')))
    .innerJoin(articles, eq(articles.id, articleSubjects.articleId))
    .groupBy(subjects.slug)
    .orderBy(desc(sql`count(distinct ${articles.id})`))
    .limit(60);

  const mostDiscussed: MostDiscussedGame[] = [];
  for (const r of discussedRows) {
    const game = bySlug.get(r.slug);
    if (!game) continue; // coverage on a subject not (yet) in the catalog
    mostDiscussed.push({
      ...game,
      articleCount: Number(r.articleCount) || 0,
      sourceCount: Number(r.sourceCount) || 0,
    });
    if (mostDiscussed.length >= discoveryRules.discoveryMostDiscussed + 24) break;
  }

  return {
    catalogTotal: all.length,
    topRated: curateList(
      sortCatalog(all, 'rating'),
      (x) => x.slug,
      curTop,
      discoveryRules.discoveryTopRated,
    ),
    mostDiscussed: curateList(
      mostDiscussed,
      (x) => x.slug,
      curDiscussed,
      discoveryRules.discoveryMostDiscussed,
      new Map(
        curDiscussed.pins
          .map((slug) => bySlug.get(slug))
          .filter((x): x is CatalogGame => Boolean(x))
          .map((x) => [x.slug, { ...x, articleCount: 0, sourceCount: 0 }]),
      ),
    ),
    genres: facetTally(all.flatMap((g) => g.genres)),
    comingSoon: curateList(
      await getUpcomingData(),
      (x) => x.slug,
      curSoon,
      discoveryRules.discoveryComingSoon,
    ),
  };
}

// ── upcoming (SPEC I5b; BLUEPRINT 2.4) ───────────────────────────────────────

/** A not-yet-released game — status + (partial/unknown) date for the countdown. */
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

/** Today as YYYY-MM-DD (UTC) — for lexicographic comparison with release dates. */
function todayIso(): string {
  const d = new Date();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${m}-${day}`;
}

/** Sort helper: dated soonest→latest first; undated (TBA) last, alphabetical. */
export function byReleaseThenName(
  a: { releaseDate: string | null; name: string },
  b: { releaseDate: string | null; name: string },
): number {
  if (a.releaseDate && b.releaseDate)
    return a.releaseDate.localeCompare(b.releaseDate) || a.name.localeCompare(b.name);
  if (a.releaseDate) return -1;
  if (b.releaseDate) return 1;
  return a.name.localeCompare(b.name);
}

/** A pre-release game is "upcoming" by status: announced / in-dev / not-yet-out EA. */
export function isPreReleaseByStatus(
  status: string,
  releaseDate: string | null,
  today: string,
): boolean {
  if (status === 'announced' || status === 'in_development') return true;
  // early-access is already playable — keep it only while its 1.0 is still ahead
  // (or undated); never a years-old EA launch.
  if (status === 'early_access') return releaseDate == null || releaseDate >= today;
  return false;
}

/**
 * The upcoming slate (AUTO by status + MANUAL override). A game is in Upcoming
 * when it's pre-release by status OR force-shown by an admin, and NOT when it's
 * force-hidden — the override always wins. Soonest-first. Used by the homepage
 * "coming soon" rail; the /upcoming page uses the grouped `getUpcomingPage`.
 */
export async function getUpcomingData(): Promise<UpcomingGame[]> {
  const rows = await db
    .select({
      id: games.id,
      slug: subjects.slug,
      name: subjects.name,
      status: games.status,
      releaseDate: games.releaseDate,
      genres: games.genres,
      platforms: games.platforms,
      developer: games.developer,
      publisher: games.publisher,
      series: games.series,
      summary: games.summary,
      coverUrl: games.coverUrl,
      upcomingOverride: games.upcomingOverride,
    })
    .from(games)
    .innerJoin(subjects, and(eq(games.subjectId, subjects.id), eq(subjects.type, 'game')));

  const today = todayIso();
  return rows
    .filter((r) => {
      if (r.upcomingOverride === 'hide') return false; // manual force-hide wins
      if (r.upcomingOverride === 'show') return true; // manual force-show wins
      return isPreReleaseByStatus(r.status, r.releaseDate ?? null, today);
    })
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      status: r.status,
      releaseDate: r.releaseDate ?? null,
      genres: r.genres ?? [],
      platforms: r.platforms ?? [],
      developer: r.developer ?? null,
      publisher: r.publisher ?? null,
      series: r.series ?? null,
      summary: r.summary ?? null,
      coverUrl: publicAssetUrl(r.coverUrl),
    }))
    .sort(byReleaseThenName);
}

// ── Upcoming enrichment: grouped discovery + New + overrides + promoted ───────
export interface UpcomingEntry extends UpcomingGame {
  isIndie: boolean;
  /** Editorial curatorial pin — floats the entry up. UNLABELED (our own opinion). */
  featured: boolean;
  /** PAID promotion (I8 placement) — carries the render-forced Promoted label. */
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
  /** Facets for the genre/platform filters (reuse the A1 filter URLs). */
  genres: string[];
  platforms: string[];
  newWindowDays: number;
  filters: { genre: string | null; platform: string | null; indie: boolean };
}

export interface UpcomingFilters {
  genre?: string;
  platform?: string;
  indie?: boolean;
}

const NEW_WINDOW_DAYS_DEFAULT = 30;

/**
 * The "New" window in days (recently-released) — admin-configurable, NOT
 * hardcoded. Lives in the `lists` app_setting alongside the other homepage
 * list/ranking knobs (edited on the Control Panel's Lists & slots page).
 */
async function newWindowDays(): Promise<number> {
  try {
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, 'lists'))
      .limit(1);
    const raw = (row?.value ?? {}) as { newWindowDays?: unknown };
    const n = raw.newWindowDays;
    if (typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 365) return n;
  } catch {
    /* fall through to default */
  }
  return NEW_WINDOW_DAYS_DEFAULT;
}

/** YYYY-MM-DD `days` before today (UTC) — the lower bound of the "New" window. */
function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${m}-${day}`;
}

const normUpcomingFilter = (v: string | undefined): string | null => {
  const s = (v ?? '').trim().toLowerCase();
  return s ? s : null;
};

/**
 * The enriched Upcoming page (Upcoming enrichment). Groups by entry type —
 * upcoming games, upcoming DLC/expansions (add-ons tied to a parent), and a
 * "New" section (recently released within the admin-configured window). AUTO +
 * MANUAL: pre-release-by-status default, admin force-show/hide overrides, an
 * editorial (unlabeled) featured pin, and the PAID Promoted flag (I8 placement,
 * always labeled) surfaced + floated. Genre/platform/indie filters reuse the A1
 * pattern; facets derive from the full upcoming set so the option list is stable.
 */
export async function getUpcomingPage(filters: UpcomingFilters = {}): Promise<UpcomingPageData> {
  const today = todayIso();
  const [windowDays, promotions] = await Promise.all([newWindowDays(), activeGamePromotions()]);
  const since = isoDaysAgo(windowDays);

  const rows = await db
    .select({
      id: games.id,
      slug: subjects.slug,
      name: subjects.name,
      status: games.status,
      releaseDate: games.releaseDate,
      genres: games.genres,
      platforms: games.platforms,
      developer: games.developer,
      publisher: games.publisher,
      series: games.series,
      summary: games.summary,
      coverUrl: games.coverUrl,
      upcomingOverride: games.upcomingOverride,
      upcomingFeatured: games.upcomingFeatured,
      isIndie: games.isIndie,
    })
    .from(games)
    .innerJoin(subjects, and(eq(games.subjectId, subjects.id), eq(subjects.type, 'game')));

  const toEntry = (r: (typeof rows)[number]): UpcomingEntry => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    status: r.status,
    releaseDate: r.releaseDate ?? null,
    genres: r.genres ?? [],
    platforms: r.platforms ?? [],
    developer: r.developer ?? null,
    publisher: r.publisher ?? null,
    series: r.series ?? null,
    summary: r.summary ?? null,
    coverUrl: publicAssetUrl(r.coverUrl),
    isIndie: r.isIndie,
    featured: r.upcomingFeatured,
    promoted: promotions.has(r.slug) ? { advertiser: promotions.get(r.slug)! } : null,
  });

  // Upcoming games: pre-release by status OR force-shown; never force-hidden.
  const upcoming = rows
    .filter((r) => {
      if (r.upcomingOverride === 'hide') return false;
      if (r.upcomingOverride === 'show') return true;
      return isPreReleaseByStatus(r.status, r.releaseDate ?? null, today);
    })
    .map(toEntry);

  // New: released within the window, force-hidden respected (never force-shown —
  // "New" is strictly a post-release window, not an override target).
  const newReleases = rows
    .filter(
      (r) =>
        r.upcomingOverride !== 'hide' &&
        r.status === 'released' &&
        r.releaseDate != null &&
        r.releaseDate <= today &&
        r.releaseDate >= since,
    )
    .map(toEntry)
    .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '')); // newest first

  // Facets from the FULL upcoming set (stable option list), before filtering.
  const genres = facetList(upcoming.flatMap((g) => g.genres));
  const platforms = facetList(upcoming.flatMap((g) => g.platforms));

  // Apply the requested filters to the games section only.
  const genre = normUpcomingFilter(filters.genre);
  const platform = normUpcomingFilter(filters.platform);
  const indie = filters.indie === true;
  let filtered = upcoming;
  if (genre) filtered = filtered.filter((g) => g.genres.some((x) => x.toLowerCase() === genre));
  if (platform)
    filtered = filtered.filter((g) => g.platforms.some((x) => x.toLowerCase() === platform));
  if (indie) filtered = filtered.filter((g) => g.isIndie);

  // Phase P S3b — rules.upcoming: editor-featured games float to the front
  // (featuredFirst); paid games go to the front (no positions set) or to the
  // admin-set paid positions; everything else soonest-first.
  const upRules = (await rulesSettings()).upcoming;
  const byPositions = upRules.paidPositions.length > 0;
  const ordered = filtered.sort((a, b) => {
    const aTop = (upRules.featuredFirst && a.featured) || (!byPositions && a.promoted) ? 1 : 0;
    const bTop = (upRules.featuredFirst && b.featured) || (!byPositions && b.promoted) ? 1 : 0;
    if (aTop !== bTop) return bTop - aTop;
    return byReleaseThenName(a, b);
  });
  let gamesSorted = ordered;
  if (byPositions) {
    const paid = ordered.filter((g) => g.promoted && !(upRules.featuredFirst && g.featured));
    const rest = ordered.filter((g) => !paid.includes(g));
    upRules.paidPositions.forEach((pos, k) => {
      const item = paid[k];
      if (item) rest.splice(Math.min(pos - 1, rest.length), 0, item);
    });
    // more paid games than positions: after the positioned ones, in date order
    gamesSorted = [
      ...rest,
      ...paid.slice(upRules.paidPositions.length).filter((g) => !rest.includes(g)),
    ];
  }

  // Upcoming DLC / expansions: add-ons tied to a PARENT game, not yet out.
  const dlcRows = await db
    .select({
      id: gameDlc.id,
      name: gameDlc.name,
      releaseDate: gameDlc.releaseDate,
      priceCents: gameDlc.priceCents,
      currency: gameDlc.currency,
      url: gameDlc.url,
      parentSlug: subjects.slug,
      parentName: subjects.name,
    })
    .from(gameDlc)
    .innerJoin(games, eq(gameDlc.gameId, games.id))
    .innerJoin(subjects, eq(games.subjectId, subjects.id));
  const dlc = dlcRows
    .filter((d) => d.releaseDate == null || d.releaseDate >= today)
    .map((d) => ({
      id: d.id,
      name: d.name,
      parentSlug: d.parentSlug,
      parentName: d.parentName,
      releaseDate: d.releaseDate ?? null,
      priceCents: d.priceCents ?? null,
      currency: d.currency,
      url: d.url ?? null,
    }))
    .sort(byReleaseThenName);

  return {
    games: gamesSorted,
    dlc,
    newReleases,
    genres,
    platforms,
    newWindowDays: windowDays,
    filters: { genre, platform, indie },
  };
}

/** Distinct, case-folded facet values sorted by frequency (for a filter list). */
function facetList(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const key = v.trim();
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map((e) => e[0]);
}

// ── sources (SPEC I5b; BLUEPRINT 2.5) ────────────────────────────────────────

/** One outlet on the sources index — ownership + reputation + coverage stats. */
export interface SourceCard {
  slug: string;
  name: string;
  typeLabel: string | null;
  parentCompany: string | null;
  articleCount: number;
  /** Share of this outlet's coverage carrying affiliate/sponsored signals (0..100). */
  affiliatePct: number | null;
  /**
   * Reputation 0..100 — editor baseline where set, else avg measured quality.
   * Null while `bias.showQuality` is off (it IS the quality axis, per outlet).
   */
  reputation: number | null;
  /** How many OTHER indexed outlets share this outlet's parent (conflict signal). */
  ownerSiblingCount: number;
}

export interface SourcesData {
  sources: SourceCard[];
  /** Parent companies that own ≥2 indexed outlets — the shared-ownership map. */
  owners: { name: string; outlets: number }[];
  articleTotal: number;
}

interface SourceAgg {
  tally: TopicFlagTally;
  qualitySum: number;
  qualityN: number;
}

/** Aggregate per-source coverage stats from the article feed (bounded; one read). */
async function aggregateSourceStats(): Promise<Map<string, SourceAgg>> {
  const rows = await db
    .select({
      sourceId: articles.sourceId,
      breakdown: articles.influenceBreakdown,
      qualityScore: articles.qualityScore,
      qualityOverride: articles.qualityOverride,
    })
    .from(articles)
    .where(isNotNull(articles.sourceId));

  const map = new Map<string, SourceAgg>();
  for (const r of rows) {
    if (!r.sourceId) continue;
    const agg = map.get(r.sourceId) ?? { tally: emptyFlagTally(), qualitySum: 0, qualityN: 0 };
    agg.tally.total += 1;
    const flags = flagsFromBreakdown(r.breakdown);
    if (flags.length === 0) agg.tally.independent += 1;
    else for (const f of flags) agg.tally[f] += 1;
    const quality = r.qualityOverride ?? r.qualityScore ?? null;
    if (quality != null) {
      agg.qualitySum += quality;
      agg.qualityN += 1;
    }
    map.set(r.sourceId, agg);
  }
  return map;
}

function affiliateShare(tally: TopicFlagTally): number | null {
  if (tally.total === 0) return null;
  // The two COMMERCIAL signals (paid placement / affiliate revenue) as a share.
  return Math.round(((tally.sponsored + tally.affiliate) / tally.total) * 100);
}

function reputationOf(agg: SourceAgg | undefined, baseline: number | null): number | null {
  if (baseline != null) return Math.round(baseline * 100);
  if (agg && agg.qualityN > 0) return Math.round(agg.qualitySum / agg.qualityN);
  return null;
}

/** The sources index — every active outlet with ownership, reputation + stats. */
export async function getSourcesData(): Promise<SourcesData> {
  const [srcRows, agg, settings] = await Promise.all([
    db
      .select({
        id: sources.id,
        slug: sources.slug,
        name: sources.name,
        typeLabel: sourceTypes.label,
        parentCompany: sources.parentCompany,
        reputationBaseline: sources.reputationBaseline,
        statArticleCount: sources.statArticleCount,
        statAffiliatePct: sources.statAffiliatePct,
        statAvgTrust: sources.statAvgTrust,
      })
      .from(sources)
      .leftJoin(sourceTypes, eq(sources.typeId, sourceTypes.id))
      .where(eq(sources.status, 'active'))
      .orderBy(asc(sources.name)),
    aggregateSourceStats(),
    displaySettings(),
  ]);

  // Shared-ownership map: how many indexed outlets each parent company owns.
  const ownerCounts = new Map<string, number>();
  for (const s of srcRows) {
    if (s.parentCompany)
      ownerCounts.set(s.parentCompany, (ownerCounts.get(s.parentCompany) ?? 0) + 1);
  }

  let articleTotal = 0;
  const cards: SourceCard[] = srcRows.map((s) => {
    const a = agg.get(s.id);
    // Editor/job-set stat columns win (auto + manual override); else computed live.
    const articleCount = s.statArticleCount ?? a?.tally.total ?? 0;
    articleTotal += a?.tally.total ?? 0;
    const affiliatePct =
      s.statAffiliatePct != null
        ? Math.round(s.statAffiliatePct)
        : a
          ? affiliateShare(a.tally)
          : null;
    const reputation = !settings.showQuality
      ? null
      : s.statAvgTrust != null
        ? Math.round(s.statAvgTrust)
        : reputationOf(a, s.reputationBaseline);
    return {
      slug: s.slug,
      name: s.name,
      typeLabel: s.typeLabel,
      parentCompany: s.parentCompany,
      articleCount,
      affiliatePct,
      reputation,
      ownerSiblingCount: s.parentCompany ? (ownerCounts.get(s.parentCompany) ?? 1) - 1 : 0,
    };
  });

  const owners = [...ownerCounts.entries()]
    .filter(([, n]) => n >= 2)
    .map(([name, outlets]) => ({ name, outlets }))
    .sort((a, b) => b.outlets - a.outlets || a.name.localeCompare(b.name));

  return { sources: cards, owners, articleTotal };
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
  /** Null while `bias.showQuality` is off (see SourceCard.reputation). */
  reputation: number | null;
  /** PUBLIC flag distribution across this outlet's coverage (counts). */
  flags: TopicFlagTally;
  integrityTally: IntegrityTally;
  display: PublicDisplay;
  /** Conflict: other indexed outlets under the same parent company. */
  owner: { name: string; siblings: { slug: string; name: string }[] } | null;
  /** Recent coverage — excerpt + link only (I1 copyright). */
  recentArticles: GameArticleRow[];
  /** Games this outlet covers most (the "what they write about" signal). */
  topGames: { slug: string; name: string; count: number }[];
}

/** One outlet's full profile (SPEC I5b). Returns null on an unknown slug (404). */
export async function getSourceDetail(slug: string): Promise<SourceDetail | null> {
  const [s] = await db
    .select({
      id: sources.id,
      slug: sources.slug,
      name: sources.name,
      typeLabel: sourceTypes.label,
      parentCompany: sources.parentCompany,
      websiteUrl: sources.websiteUrl,
      description: sources.description,
      status: sources.status,
      reputationBaseline: sources.reputationBaseline,
      statArticleCount: sources.statArticleCount,
      statAffiliatePct: sources.statAffiliatePct,
      statAvgTrust: sources.statAvgTrust,
    })
    .from(sources)
    .leftJoin(sourceTypes, eq(sources.typeId, sourceTypes.id))
    .where(eq(sources.slug, slug))
    .limit(1);
  if (!s) return null;

  const settings = await displaySettings();
  const evidence = await publicIntegrityKinds(settings.integrityAutoPublish);
  // Per-source PUBLIC flag tally + quality (the same model as the news side).
  const aggRows = await db
    .select({
      id: articles.id,
      articleType: articles.articleType,
      breakdown: articles.influenceBreakdown,
      qualityScore: articles.qualityScore,
      qualityOverride: articles.qualityOverride,
    })
    .from(articles)
    .where(eq(articles.sourceId, s.id));
  const agg: SourceAgg = { tally: emptyFlagTally(), qualitySum: 0, qualityN: 0 };
  const integrity = emptyIntegrityTally();
  for (const r of aggRows) {
    const flags = publicFlags(r.breakdown, r.articleType, hasReviewCopy(evidence, r.id));
    tallyArticle(agg.tally, integrity, flags, evidence.get(r.id));
    const quality = r.qualityOverride ?? r.qualityScore ?? null;
    if (quality != null) {
      agg.qualitySum += quality;
      agg.qualityN += 1;
    }
  }

  const sourceRules = (await rulesSettings()).lists;
  const srcCats = await categoryContext();
  const [recentRows, topGameRows, siblingRows] = await Promise.all([
    db
      .select({
        id: articles.id,
        title: articles.title,
        excerpt: articles.excerpt,
        url: articles.url,
        origin: articles.origin,
        author: articles.author,
        articleType: articles.articleType,
        publishDate: articles.publishDate,
        qualityScore: articles.qualityScore,
        qualityOverride: articles.qualityOverride,
        influenceBreakdown: articles.influenceBreakdown,
        category: articleCategorySql,
      })
      .from(articles)
      // Phase P S4 (owner): "hide" drops; "low" stays with a category chip.
      .where(and(eq(articles.sourceId, s.id), notInCategories(articleCategorySql, srcCats.hide)))
      .orderBy(desc(articles.publishDate))
      .limit(sourceRules.sourceRecentCoverage),
    db
      .select({
        slug: subjects.slug,
        name: subjects.name,
        n: sql<number>`count(*)::int`,
      })
      .from(articleSubjects)
      .innerJoin(articles, eq(articleSubjects.articleId, articles.id))
      .innerJoin(
        subjects,
        and(eq(subjects.id, articleSubjects.subjectId), eq(subjects.type, 'game')),
      )
      .where(eq(articles.sourceId, s.id))
      .groupBy(subjects.slug, subjects.name)
      .orderBy(desc(sql`count(*)`))
      .limit(Math.max(1, sourceRules.sourceTopGames)),
    s.parentCompany
      ? db
          .select({ slug: sources.slug, name: sources.name })
          .from(sources)
          .where(
            and(
              eq(sources.parentCompany, s.parentCompany),
              ne(sources.id, s.id),
              eq(sources.status, 'active'),
            ),
          )
          .orderBy(asc(sources.name))
      : Promise.resolve([] as { slug: string; name: string }[]),
  ]);

  const recentArticles = await detailRows(
    recentRows.map((r) => ({
      ...r,
      sourceName: s.name,
      sourceSlug: s.slug,
      category: String(r.category),
    })),
    settings,
    evidence,
    srcCats,
  );

  return {
    slug: s.slug,
    name: s.name,
    typeLabel: s.typeLabel,
    parentCompany: s.parentCompany,
    websiteUrl: s.websiteUrl,
    description: s.description,
    articleCount: s.statArticleCount ?? agg.tally.total,
    affiliatePct:
      s.statAffiliatePct != null ? Math.round(s.statAffiliatePct) : affiliateShare(agg.tally),
    reputation: !settings.showQuality
      ? null
      : s.statAvgTrust != null
        ? Math.round(s.statAvgTrust)
        : reputationOf(agg, s.reputationBaseline),
    flags: agg.tally,
    integrityTally: integrity,
    display: publicDisplay(settings),
    owner:
      s.parentCompany && siblingRows.length > 0
        ? { name: s.parentCompany, siblings: siblingRows }
        : s.parentCompany
          ? { name: s.parentCompany, siblings: [] }
          : null,
    recentArticles,
    topGames: topGameRows.map((g) => ({ slug: g.slug, name: g.name, count: Number(g.n) })),
  };
}

/** Every active source slug for the sitemap (each outlet has a public profile). */
export async function getSitemapSources(): Promise<SitemapEntry[]> {
  const rows = await db
    .select({ slug: sources.slug, updatedAt: sources.updatedAt })
    .from(sources)
    .where(eq(sources.status, 'active'))
    .orderBy(asc(sources.name));
  return rows.map((r) => ({
    slug: r.slug,
    lastModified: r.updatedAt ? r.updatedAt.toISOString() : null,
  }));
}

// ── sitemap (SPEC I5a SEO) ───────────────────────────────────────────────────

export interface SitemapEntry {
  slug: string;
  lastModified: string | null;
}

/**
 * Every INDEXABLE story for the sitemap (Phase P S4): enough sources, or an AI
 * summary and a linked game, or an editor's "index" — never an editor's noindex.
 */
export async function getSitemapTopics(): Promise<SitemapEntry[]> {
  return (await indexableTopics()).map((t) => ({
    slug: t.slug,
    lastModified: t.lastModified ? t.lastModified.toISOString() : null,
  }));
}

/** Every catalog game slug for the sitemap (each game has a public hub page). */
export async function getSitemapGames(): Promise<SitemapEntry[]> {
  const rows = await db
    .select({ slug: subjects.slug, updatedAt: subjects.updatedAt })
    .from(games)
    .innerJoin(subjects, and(eq(games.subjectId, subjects.id), eq(subjects.type, 'game')))
    .where(eq(games.noindex, false))
    .orderBy(asc(subjects.name));
  return rows.map((r) => ({
    slug: r.slug,
    lastModified: r.updatedAt ? r.updatedAt.toISOString() : null,
  }));
}
