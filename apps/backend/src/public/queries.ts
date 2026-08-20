import { and, arrayOverlaps, asc, desc, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import {
  INFLUENCE_FLAGS,
  type BiasBreakdown,
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
import { activeGamePromotions, activePromotedGameSlugs } from '../ads/service';
import { applyPins, listsSettings } from '../lists/settings';

/**
 * Public read-side composition (SPEC I5a) — the ONLY data the public homepage and
 * topic pages consume. Everything here is PRE-COMPUTED and stored (bias
 * distributions from I4a, rating summaries from I4b); nothing recomputes on the
 * request path (CLAUDE.md "nothing heavy on user request"). These payloads are
 * also the leak-proof surface: they select an explicit allowlist of columns and
 * NEVER touch `articles.internal_assessment` (the internal-only field) — that
 * column is not referenced anywhere in this file, by design.
 */

/** A topic shaped as a homepage card (hero spotlight + main feed). */
export interface TopicCard {
  id: string;
  slug: string;
  title: string;
  tldr: string | null;
  /** The stored I3 AI summary (neutral "what happened"); labeled AI on render. */
  aiSummary: string | null;
  status: string;
  typeLabel: string | null;
  articleCount: number;
  sourceCount: number;
  /** Most-linked game across the topic's articles — the cover/label subject. */
  primaryGame: { name: string; slug: string } | null;
  distribution: TopicBiasDistribution;
  /** Topic-level distribution of factual influence flags (counts, not a scale). */
  flags: TopicFlagTally;
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
  /** Public effective bias (override ?? auto). Never the internal field. */
  influence: number | null;
  quality: number | null;
  /** The factual influence flags this article carries (none ⇒ independent). */
  flags: InfluenceFlag[];
  /** Plain-language "why" for the hover tooltip (named signal labels). */
  reasons: string[];
}

/** A one-line homepage pulse ("Today: X stories · Y articles · Z% independent"). */
export interface Briefing {
  stories: number;
  articles: number;
  independentPct: number | null;
  readMinutes: number;
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

export interface HomepageData {
  hero: TopicCard[];
  feed: TopicCard[];
  latest: LatestArticle[];
  topRated: RankedGame[];
  controversial: RankedGame[];
  briefing: Briefing;
  genres: GenreCount[];
}

/**
 * Map a stored breakdown signal → its public FLAG. Only the four named factual
 * flags surface publicly; baselines and the (dormant) source-conflict signal
 * still feed the influence SCORE but are not shown as chips. Influence is mostly
 * binary facts, so the public display names the actual signals instead of a bar.
 */
const FLAG_BY_SIGNAL: Record<string, InfluenceFlag> = {
  sponsored: 'sponsored',
  affiliate: 'affiliate',
  reviewCopy: 'reviewCopy',
  opinionFraming: 'opinion',
};

/** The factual influence flags an article carries (from its stored breakdown). */
function flagsFromBreakdown(breakdown: BiasBreakdown | null): InfluenceFlag[] {
  if (!breakdown) return [];
  const present = new Set<InfluenceFlag>();
  for (const c of breakdown.contributions) {
    if (c.points > 0) {
      const flag = FLAG_BY_SIGNAL[c.signal];
      if (flag) present.add(flag);
    }
  }
  // Canonical order, de-duplicated.
  return INFLUENCE_FLAGS.filter((f) => present.has(f));
}

function emptyFlagTally(): TopicFlagTally {
  return { total: 0, independent: 0, sponsored: 0, affiliate: 0, reviewCopy: 0, opinion: 0 };
}

/**
 * Topic-level distribution of factual influence flags across each topic's
 * articles (counts, not an averaged score). The flags are FACTS from the stored
 * breakdown, so they're read straight from the breakdown — independent of any
 * editor score override (which only moves the judgment, never the facts).
 */
async function flagTallyByTopic(topicIds: string[]): Promise<Map<string, TopicFlagTally>> {
  const rows = await db
    .select({
      topicId: articleTopics.topicId,
      breakdown: articles.influenceBreakdown,
    })
    .from(articleTopics)
    .innerJoin(articles, eq(articleTopics.articleId, articles.id))
    .where(inArray(articleTopics.topicId, topicIds));

  const map = new Map<string, TopicFlagTally>();
  for (const r of rows) {
    const tally = map.get(r.topicId) ?? emptyFlagTally();
    tally.total += 1;
    const flags = flagsFromBreakdown(r.breakdown);
    if (flags.length === 0) tally.independent += 1;
    else for (const f of flags) tally[f] += 1;
    map.set(r.topicId, tally);
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
async function loadTopicCards(): Promise<TopicCard[]> {
  const topicRows = await db
    .select({
      id: topics.id,
      slug: topics.slug,
      title: topics.title,
      tldr: topics.tldr,
      aiSummary: topics.aiSummary,
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
    flagTallyByTopic(ids),
  ]);

  return withDist.map((t) => ({
    id: t.id,
    slug: t.slug,
    title: t.title,
    tldr: t.tldr,
    aiSummary: t.aiSummary,
    status: t.status,
    typeLabel: t.typeLabel,
    articleCount: t.distribution.articleCount,
    sourceCount: sourceCounts.get(t.id) ?? 0,
    primaryGame: primaryGames.get(t.id) ?? null,
    distribution: t.distribution,
    flags: flagTallies.get(t.id) ?? emptyFlagTally(),
    lastActivityAt: t.lastActivityAt ? t.lastActivityAt.toISOString() : null,
  }));
}

function activityTime(c: TopicCard): number {
  return c.lastActivityAt ? new Date(c.lastActivityAt).getTime() : 0;
}

/** Named influence signals from a stored breakdown — the public "why". */
function influenceReasons(breakdown: BiasBreakdown | null): string[] {
  if (!breakdown) return [];
  return breakdown.contributions
    .filter((c) => c.points > 0 && c.signal !== 'sourceBaseline' && c.signal !== 'baselineNeutral')
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map((c) => c.label);
}

/** Newest aggregated articles for the "Latest news" column (excerpt + link only). */
async function loadLatestArticles(limit: number): Promise<LatestArticle[]> {
  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      origin: articles.origin,
      url: articles.url,
      excerpt: articles.excerpt,
      publishDate: articles.publishDate,
      sourceName: sources.name,
      sourceSlug: sources.slug,
      influenceScore: articles.influenceScore,
      influenceOverride: articles.influenceOverride,
      qualityScore: articles.qualityScore,
      qualityOverride: articles.qualityOverride,
      influenceBreakdown: articles.influenceBreakdown,
    })
    .from(articles)
    .leftJoin(sources, eq(articles.sourceId, sources.id))
    .where(isNotNull(articles.publishDate))
    .orderBy(desc(articles.publishDate))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    sourceName: r.sourceName,
    sourceSlug: r.sourceSlug,
    url: r.url,
    excerpt: r.excerpt,
    publishDate: r.publishDate ? r.publishDate.toISOString() : null,
    origin: r.origin,
    influence: r.influenceOverride ?? r.influenceScore ?? null,
    quality: r.qualityOverride ?? r.qualityScore ?? null,
    flags: flagsFromBreakdown(r.influenceBreakdown),
    reasons: influenceReasons(r.influenceBreakdown),
  }));
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
    .where(
      or(
        isNotNull(gameRatingSummaries.ourScore),
        isNotNull(gameRatingSummaries.criticsScore),
        isNotNull(gameRatingSummaries.communityOurScore),
      ),
    );

  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    our: r.our ?? null,
    critics: effective(r.criticsAuto, r.criticsOverride),
    community: effective(r.communityAuto, r.communityOverride),
    web: r.web ?? null,
    disconnectValue: r.disconnectValue ?? null,
    disconnectBand: r.disconnectBand ?? null,
  }));
}

/** Combined display strength for "Top Rated" (critics + our + community, where present). */
function topScore(g: RankedGame): number {
  const parts = [g.critics, g.our, g.community].filter((n): n is number => n != null);
  if (parts.length === 0) return -1;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

/** Aggregate "today's briefing" pulse from the stored cards. */
function buildBriefing(cards: TopicCard[], hero: TopicCard[], feed: TopicCard[]): Briefing {
  let independent = 0;
  let influenced = 0;
  let articles = 0;
  for (const c of cards) {
    independent += c.distribution.influence.independent;
    influenced += c.distribution.influence.influenced;
    articles += c.articleCount;
  }
  const totalBias = independent + influenced;
  const independentPct = totalBias > 0 ? Math.round((independent / totalBias) * 100) : null;
  // Read time scaled to the briefing surface (hero + feed), not the whole archive.
  const readMinutes = Math.max(5, Math.min(12, Math.round((hero.length + feed.length) / 3)));
  return { stories: cards.length, articles, independentPct, readMinutes };
}

/**
 * Compose the homepage payload from stored data. The hero leads with the most-
 * covered multi-source stories; the main feed is the rest, newest-first.
 */
export async function getHomepageData(): Promise<HomepageData> {
  // AUTO + MANUAL: rail sizes + pins come from the admin `lists` config (nothing
  // hardcoded); the automatic ordering runs underneath and pins float on top.
  const [cards, latest, ranked, genres, cfg] = await Promise.all([
    loadTopicCards(),
    loadLatestArticles(10),
    loadRankedGames(),
    loadGenres(),
    listsSettings(),
  ]);
  const promotedSlugs = cfg.pinPromotedGames ? await activePromotedGameSlugs() : [];

  // Hero: lead with the most-covered, multi-source stories (newspaper front
  // page), then float any manually-pinned topics to the very front.
  const byCoverage = [...cards].sort(
    (a, b) =>
      b.sourceCount - a.sourceCount ||
      b.articleCount - a.articleCount ||
      activityTime(b) - activityTime(a),
  );
  const hero = applyPins(byCoverage, (c) => c.slug, cfg.pinnedTopicSlugs).slice(0, cfg.heroCount);
  const heroIds = new Set(hero.map((c) => c.id));

  // Main feed: everything else, newest-active first.
  const feed = cards
    .filter((c) => !heroIds.has(c.id))
    .sort((a, b) => activityTime(b) - activityTime(a))
    .slice(0, cfg.feedCount);

  // Games-in-focus (disconnect) and Top-rated must show DIFFERENT games: the
  // focus set is the biggest gaps; Top-rated then EXCLUDES those.
  const controversial = ranked
    .filter((g) => g.disconnectValue != null)
    .sort((a, b) => (b.disconnectValue ?? 0) - (a.disconnectValue ?? 0))
    .slice(0, cfg.focusCount);
  const focusSlugs = new Set(controversial.slice(0, 3).map((g) => g.slug));
  // Auto-pin: promoted games first (if enabled), then explicit manual pins win
  // (manual override). Both float above the automatic score order.
  const gamePins = [
    ...cfg.pinnedGameSlugs,
    ...promotedSlugs.filter((s) => !cfg.pinnedGameSlugs.includes(s)),
  ];
  const topRated = applyPins(
    ranked.filter((g) => !focusSlugs.has(g.slug)).sort((a, b) => topScore(b) - topScore(a)),
    (g) => g.slug,
    gamePins,
  ).slice(0, cfg.topRatedCount);

  return {
    hero,
    feed,
    latest,
    topRated,
    controversial,
    genres,
    briefing: buildBriefing(cards, hero, feed),
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
  /** Effective public scores (override ?? auto) — for sort/filter only. */
  influence: number | null;
  quality: number | null;
  /** Per-article factual influence flags (none ⇒ independent). */
  flags: InfluenceFlag[];
  /** Named signal labels for the hover "why". */
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
  if (r.our == null && critics == null && community == null) return null;
  return {
    slug: r.slug,
    name: r.name,
    our: r.our ?? null,
    critics,
    community,
    criticsOutletCount: r.criticsCount ?? null,
    communityCount: r.communityCount ?? null,
  };
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
    .limit(12);
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
      .where(and(inArray(topics.id, ids), isNotNull(topics.biasDistribution))),
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
    .slice(0, 5)
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
        isPrimary: articleTopics.isPrimary,
        sourceName: sources.name,
        sourceSlug: sources.slug,
        influenceScore: articles.influenceScore,
        influenceOverride: articles.influenceOverride,
        qualityScore: articles.qualityScore,
        qualityOverride: articles.qualityOverride,
        influenceBreakdown: articles.influenceBreakdown,
      })
      .from(articleTopics)
      .innerJoin(articles, eq(articleTopics.articleId, articles.id))
      .leftJoin(sources, eq(articles.sourceId, sources.id))
      .where(eq(articleTopics.topicId, topic.id))
      .orderBy(desc(articles.publishDate)),
    linkedGamesForTopic(topic.id),
    flagTallyByTopic([topic.id]),
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
  const [gameRating, related] = await Promise.all([
    primary ? gameRatingForSubject(primary.subjectId) : Promise.resolve(null),
    primary ? relatedTopicsForGame(primary.subjectId, topic.id) : Promise.resolve([]),
  ]);

  const articleRows: TopicArticleRow[] = artRows.map((r) => ({
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
    influence: r.influenceOverride ?? r.influenceScore ?? null,
    quality: r.qualityOverride ?? r.qualityScore ?? null,
    flags: flagsFromBreakdown(r.influenceBreakdown),
    reasons: influenceReasons(r.influenceBreakdown),
    isPrimary: r.isPrimary,
  }));

  return {
    id: topic.id,
    slug: topic.slug,
    title: topic.title,
    tldr: topic.tldr,
    aiSummary: topic.aiSummary,
    status: topic.status,
    typeLabel: topic.typeLabel,
    publishedAt: topic.createdAt ? topic.createdAt.toISOString() : null,
    lastActivityAt: topic.lastActivityAt ? topic.lastActivityAt.toISOString() : null,
    articleCount: topic.distribution.articleCount,
    sourceCount: sourceCounts.get(topic.id) ?? 0,
    distribution: topic.distribution,
    flags: flagTallies.get(topic.id) ?? emptyFlagTally(),
    games: gameList.map((g) => ({ name: g.name, slug: g.slug })),
    primaryGame: primary ? { name: primary.name, slug: primary.slug } : null,
    gameRating,
    articles: articleRows,
    timeline: timelineRows.map((t) => ({
      occurredAt: t.occurredAt.toISOString(),
      label: t.label,
    })),
    related,
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
  our: PublicRatingLayer;
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
    payToWinPredatory: boolean;
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
  review: PublicReview | null;
  relatedTopics: RelatedTopic[];
  articles: GameArticleRow[];
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
    payToWinPredatory: row.predatoryMonetization,
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
  return {
    verdict: r.verdict ?? null,
    pros: r.pros ?? [],
    cons: r.cons ?? [],
    platformTested: r.platformTested ?? null,
    hoursPlayed: r.hoursPlayed ?? null,
    body: r.body ?? null,
    ourScore: r.ourScore ?? null,
    author: r.author ?? null,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
  };
}

/** Articles that mention this game (excerpt + link only; per-article flags). */
async function articlesForGame(subjectId: string, limit = 12): Promise<GameArticleRow[]> {
  const rows = await db
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
      influenceBreakdown: articles.influenceBreakdown,
    })
    .from(articleSubjects)
    .innerJoin(articles, eq(articleSubjects.articleId, articles.id))
    .leftJoin(sources, eq(articles.sourceId, sources.id))
    .where(eq(articleSubjects.subjectId, subjectId))
    .orderBy(desc(articles.publishDate))
    .limit(limit);
  return rows.map((r) => ({
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
    flags: flagsFromBreakdown(r.influenceBreakdown),
    reasons: influenceReasons(r.influenceBreakdown),
  }));
}

/** Topics that mention this game — the news↔ratings bridge (graceful: []). */
async function relatedTopicsForGameSubject(subjectId: string): Promise<RelatedTopic[]> {
  const idRows = await db
    .selectDistinct({ topicId: articleTopics.topicId })
    .from(articleTopics)
    .innerJoin(articleSubjects, eq(articleSubjects.articleId, articleTopics.articleId))
    .where(eq(articleSubjects.subjectId, subjectId))
    .limit(20);
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
      .where(and(inArray(topics.id, ids), isNotNull(topics.biasDistribution))),
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
    .slice(0, 6)
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
    .limit(24);
  // Prefer same-series, then rated, then alphabetical — keep it to a tidy 6.
  return rows
    .map((r) => ({
      slug: r.slug,
      name: r.name,
      genres: r.genres ?? [],
      our: r.our ?? null,
      critics: effective(r.criticsAuto, r.criticsOverride),
      community: effective(r.communityAuto, r.communityOverride),
      sameSeries: series != null && r.series === series,
    }))
    .sort(
      (a, b) =>
        Number(b.sameSeries) - Number(a.sameSeries) ||
        (b.critics ?? b.our ?? -1) - (a.critics ?? a.our ?? -1),
    )
    .slice(0, 6)
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
  const [g] = await db
    .select({
      gameId: games.id,
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
  ] = await Promise.all([
    criticEntriesFor(g.gameId),
    webRatingsFor(g.gameId),
    contentFlagsFor(g.gameId),
    ourReviewFor(g.gameId),
    relatedTopicsForGameSubject(g.subjectId),
    articlesForGame(g.subjectId),
    relatedGamesFor(g.gameId, g.series, g.genres),
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
      // A2 display rule: editor-pinned first, then sort order, take 3.
      .orderBy(desc(gameVideos.isPinned), asc(gameVideos.sort))
      .limit(3),
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
    db
      .select({
        current: gamePlayerCounts.currentPlayers,
        peak: gamePlayerCounts.peakPlayers,
        capturedAt: gamePlayerCounts.capturedAt,
      })
      .from(gamePlayerCounts)
      .where(eq(gamePlayerCounts.gameId, g.gameId))
      .orderBy(desc(gamePlayerCounts.capturedAt))
      // B2: ~6 months of weekly history for the dated chart (seeded 26 points;
      // in production the sweep appends and this window slides).
      .limit(40),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(gameUserRatings)
      .where(eq(gameUserRatings.gameId, g.gameId)),
  ]);

  // ── shape the leak-proof rating block (effective values only) ───────────────
  let rating: PublicGameRating | null = null;
  if (summary) {
    const our = summary.ourScore ?? null;
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
        our: { score: our, count: null },
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
                ourVsCritics: summary.disconnectDetail?.ourVsCritics ?? null,
                communityVsWeb: summary.disconnectDetail?.communityVsWeb ?? null,
              }
            : null,
      };
    }
  }

  const player = playerRows[0];

  return {
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
    review,
    relatedTopics,
    articles: gameArticles,
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
          peak: player.peak ?? null,
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
}

export interface CatalogData {
  games: CatalogGame[];
  total: number;
  /** Total catalog size (before filtering) — the "X of Y games" readout. */
  catalogTotal: number;
  genres: CatalogFacet[];
  platforms: CatalogFacet[];
  /** Echoes the APPLIED filters (normalized) so the page can mark them active. */
  applied: { genre: string | null; platform: string | null; sort: string };
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
function catalogStrength(g: CatalogGame): number {
  const parts = [g.critics, g.our, g.community].filter((n): n is number => n != null);
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

  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    status: r.status,
    releaseDate: r.releaseDate ?? null,
    genres: r.genres ?? [],
    platforms: r.platforms ?? [],
    coverUrl: publicAssetUrl(r.coverUrl),
    our: r.our ?? null,
    critics: effective(r.criticsAuto, r.criticsOverride),
    community: effective(r.communityAuto, r.communityOverride),
    disconnectValue: r.disconnectValue ?? null,
    disconnectBand: (r.disconnectBand as DisconnectBand) ?? null,
  }));
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
  let filtered = all;
  if (genre) filtered = filtered.filter((g) => g.genres.some((x) => x.toLowerCase() === genre));
  if (platform)
    filtered = filtered.filter((g) => g.platforms.some((x) => x.toLowerCase() === platform));

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
    applied: { genre, platform, sort },
    page,
    perPage,
    totalPages,
  };
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
    .limit(12);

  const mostDiscussed: MostDiscussedGame[] = [];
  for (const r of discussedRows) {
    const game = bySlug.get(r.slug);
    if (!game) continue; // coverage on a subject not (yet) in the catalog
    mostDiscussed.push({
      ...game,
      articleCount: Number(r.articleCount) || 0,
      sourceCount: Number(r.sourceCount) || 0,
    });
    if (mostDiscussed.length >= 6) break;
  }

  return {
    catalogTotal: all.length,
    topRated: sortCatalog(all, 'rating').slice(0, 6),
    mostDiscussed,
    genres: facetTally(all.flatMap((g) => g.genres)),
    comingSoon: (await getUpcomingData()).slice(0, 4),
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
function byReleaseThenName(
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
function isPreReleaseByStatus(status: string, releaseDate: string | null, today: string): boolean {
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

  // Featured/promoted float to the front; then soonest-first.
  const gamesSorted = filtered.sort((a, b) => {
    const aTop = a.featured || a.promoted ? 1 : 0;
    const bTop = b.featured || b.promoted ? 1 : 0;
    if (aTop !== bTop) return bTop - aTop;
    return byReleaseThenName(a, b);
  });

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
  /** Reputation 0..100 — editor baseline where set, else avg measured quality. */
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
  const [srcRows, agg] = await Promise.all([
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
    const reputation =
      s.statAvgTrust != null ? Math.round(s.statAvgTrust) : reputationOf(a, s.reputationBaseline);
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
  reputation: number | null;
  /** Factual flag distribution across this outlet's coverage (counts). */
  flags: TopicFlagTally;
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

  // Per-source flag tally + quality (reusing the same model as the news side).
  const aggRows = await db
    .select({
      breakdown: articles.influenceBreakdown,
      qualityScore: articles.qualityScore,
      qualityOverride: articles.qualityOverride,
    })
    .from(articles)
    .where(eq(articles.sourceId, s.id));
  const agg: SourceAgg = { tally: emptyFlagTally(), qualitySum: 0, qualityN: 0 };
  for (const r of aggRows) {
    agg.tally.total += 1;
    const flags = flagsFromBreakdown(r.breakdown);
    if (flags.length === 0) agg.tally.independent += 1;
    else for (const f of flags) agg.tally[f] += 1;
    const quality = r.qualityOverride ?? r.qualityScore ?? null;
    if (quality != null) {
      agg.qualitySum += quality;
      agg.qualityN += 1;
    }
  }

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
        influenceBreakdown: articles.influenceBreakdown,
      })
      .from(articles)
      .where(eq(articles.sourceId, s.id))
      .orderBy(desc(articles.publishDate))
      .limit(10),
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
      .limit(6),
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

  const recentArticles: GameArticleRow[] = recentRows.map((r) => ({
    id: r.id,
    title: r.title,
    excerpt: r.excerpt,
    url: r.url,
    origin: r.origin,
    author: r.origin === 'ours' ? r.author : null,
    articleType: r.articleType,
    publishDate: r.publishDate ? r.publishDate.toISOString() : null,
    sourceName: s.name,
    sourceSlug: s.slug,
    flags: flagsFromBreakdown(r.influenceBreakdown),
    reasons: influenceReasons(r.influenceBreakdown),
  }));

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
    reputation:
      s.statAvgTrust != null ? Math.round(s.statAvgTrust) : reputationOf(agg, s.reputationBaseline),
    flags: agg.tally,
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

/** Every public, rendered topic slug for the sitemap (real stories, ≥1 article). */
export async function getSitemapTopics(): Promise<SitemapEntry[]> {
  const rows = await db
    .select({
      slug: topics.slug,
      distribution: topics.biasDistribution,
      lastActivityAt: topics.lastActivityAt,
      updatedAt: topics.updatedAt,
    })
    .from(topics)
    .where(isNotNull(topics.biasDistribution))
    .orderBy(desc(topics.lastActivityAt));
  return rows
    .filter((r) => (r.distribution?.articleCount ?? 0) > 0)
    .map((r) => ({
      slug: r.slug,
      lastModified: (r.lastActivityAt ?? r.updatedAt)?.toISOString() ?? null,
    }));
}

/** Every catalog game slug for the sitemap (each game has a public hub page). */
export async function getSitemapGames(): Promise<SitemapEntry[]> {
  const rows = await db
    .select({ slug: subjects.slug, updatedAt: subjects.updatedAt })
    .from(games)
    .innerJoin(subjects, and(eq(games.subjectId, subjects.id), eq(subjects.type, 'game')))
    .orderBy(asc(subjects.name));
  return rows.map((r) => ({
    slug: r.slug,
    lastModified: r.updatedAt ? r.updatedAt.toISOString() : null,
  }));
}
