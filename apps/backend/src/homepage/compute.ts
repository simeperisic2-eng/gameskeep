import { and, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import type { HomepageSectionKey } from '@gameskeep/shared/constants';
import { db } from '../db/client';
import {
  articleSubjects,
  articleTopics,
  articles,
  comments,
  follows,
  gamePlayerCounts,
  gameRatingSummaries,
  games,
  homepageSectionPins,
  homepageSectionSnapshots,
  sources,
  subjects,
  topics,
  users,
} from '../db/schema';
import { activeSectionPromotions } from '../ads/service';
import { listsSettings } from '../lists/settings';
import { byReleaseThenName, isPreReleaseByStatus } from '../public/queries';
import { getRatingSettings } from '../ratings/rating-settings';
import { voterCredibility } from '../community/weighting';
import { homepageSettings, type HomepageSettings } from './settings';
import type { SnapshotItem, SnapshotPayload } from './snapshots';
import { listSections, type SectionRow } from './sections';
import {
  average,
  cappedCredibleMass,
  composeSection,
  countedCredibility,
  matchesRules,
  playersDelta,
  trendingDelta,
  trendingScore,
  type Delta,
  type EngagementByUser,
  type RuleLists,
} from './rules';
import { publishedTagSlugsByGame } from '../tags/service';

/**
 * The homepage snapshots job (Phase P S2). Ranks every enabled section by its
 * rule, applies pins, INSERTS the paid items at their positions (any section;
 * the organic list is untouched — payment never changes data), computes the Δ
 * windows, and STORES the result — the homepage request only reads snapshots.
 * Runs off the request path: on its own queue (config saves, periodic refresh,
 * boot) and inline at the end of the ingest / rating / reputation jobs so a
 * snapshot never points at rows those jobs just replaced.
 */
const HOUR = 3_600_000;

interface TopicRow {
  id: string;
  slug: string;
  lastActivity: number;
  attrs: RuleLists;
  now: { articles: number; sources: Set<string> };
  prev: { articles: number; sources: Set<string> };
}

/** Public stories (the same visibility rule as the homepage cards) + their rule attributes. */
async function loadTopics(windowMs: number, nowMs: number): Promise<Map<string, TopicRow>> {
  const rows = await db
    .select({
      id: topics.id,
      slug: topics.slug,
      lastActivityAt: topics.lastActivityAt,
      dist: topics.biasDistribution,
    })
    .from(topics)
    .where(isNotNull(topics.biasDistribution));
  const out = new Map<string, TopicRow>();
  for (const r of rows) {
    const count = (r.dist as { articleCount?: number } | null)?.articleCount ?? 0;
    if (!(count > 0)) continue; // a story must actually have articles
    out.set(r.id, {
      id: r.id,
      slug: r.slug,
      lastActivity: r.lastActivityAt ? r.lastActivityAt.getTime() : 0,
      attrs: { categories: [], sources: [], genres: [], tags: [] },
      now: { articles: 0, sources: new Set() },
      prev: { articles: 0, sources: new Set() },
    });
  }
  if (out.size === 0) return out;

  const arts = await db
    .select({
      topicId: articleTopics.topicId,
      articleId: articles.id,
      type: articles.articleType,
      publishDate: articles.publishDate,
      sourceSlug: sources.slug,
    })
    .from(articleTopics)
    .innerJoin(articles, eq(articles.id, articleTopics.articleId))
    .leftJoin(sources, eq(sources.id, articles.sourceId))
    .where(inArray(articleTopics.topicId, [...out.keys()]));
  const topicOfArticle = new Map<string, string>();
  for (const a of arts) {
    const t = out.get(a.topicId);
    if (!t) continue;
    topicOfArticle.set(a.articleId, a.topicId);
    t.attrs.categories!.push(a.type);
    if (a.sourceSlug) t.attrs.sources!.push(a.sourceSlug);
    const at = a.publishDate ? a.publishDate.getTime() : NaN;
    if (!Number.isFinite(at) || at > nowMs) continue;
    const win = at > nowMs - windowMs ? t.now : at > nowMs - 2 * windowMs ? t.prev : null;
    if (win) {
      win.articles += 1;
      if (a.sourceSlug) win.sources.add(a.sourceSlug);
    }
  }
  // Genres / PUBLISHED taxonomy tags (Phase P S3) of the games the story's articles are about.
  if (topicOfArticle.size) {
    const tagsByGame = await publishedTagSlugsByGame();
    const gameRows = await db
      .select({ articleId: articleSubjects.articleId, gameId: games.id, genres: games.genres })
      .from(articleSubjects)
      .innerJoin(games, eq(games.subjectId, articleSubjects.subjectId))
      .where(inArray(articleSubjects.articleId, [...topicOfArticle.keys()]));
    for (const g of gameRows) {
      const t = out.get(topicOfArticle.get(g.articleId) ?? '');
      if (!t) continue;
      t.attrs.genres!.push(...(g.genres ?? []));
      t.attrs.tags!.push(...(tagsByGame.get(g.gameId) ?? []));
    }
  }
  return out;
}

/**
 * Credibility-weighted, per-user-capped engagement per story and window:
 * comments (on the story or its articles, not removed) and follows. Only
 * active accounts count; each account adds ≤ cap units × its 0→1.0 credibility.
 */
async function loadEngagement(
  topicRows: Map<string, TopicRow>,
  windowMs: number,
  nowMs: number,
  cap: number,
  minCredibility: number,
): Promise<
  Map<
    string,
    { now: { comments: number; follows: number }; prev: { comments: number; follows: number } }
  >
> {
  const result = new Map<
    string,
    { now: { comments: number; follows: number }; prev: { comments: number; follows: number } }
  >();
  const topicIds = [...topicRows.keys()];
  if (topicIds.length === 0) return result;
  const since = new Date(nowMs - 2 * windowMs);
  const articleTopic = await db
    .select({ articleId: articleTopics.articleId, topicId: articleTopics.topicId })
    .from(articleTopics)
    .where(inArray(articleTopics.topicId, topicIds));
  const topicOfArticle = new Map(articleTopic.map((r) => [r.articleId, r.topicId]));

  const commentRows = await db
    .select({
      entityType: comments.entityType,
      entityId: comments.entityId,
      userId: comments.userId,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .where(and(eq(comments.isRemoved, false), gte(comments.createdAt, since)));
  const followRows = await db
    .select({ entityId: follows.entityId, userId: follows.userId, createdAt: follows.createdAt })
    .from(follows)
    .where(and(eq(follows.entityType, 'topic'), gte(follows.createdAt, since)));

  const userIds = [...new Set([...commentRows, ...followRows].map((r) => r.userId))];
  if (userIds.length === 0) return result;
  const credSettings = (await getRatingSettings()).credibility;
  const userRows = await db
    .select({
      id: users.id,
      status: users.status,
      isEmailVerified: users.isEmailVerified,
      reputation: users.reputation,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(inArray(users.id, userIds));
  const cred = new Map<string, number>();
  for (const u of userRows) {
    cred.set(
      u.id,
      u.status === 'active'
        ? countedCredibility(voterCredibility(u, credSettings, nowMs), minCredibility)
        : 0,
    );
  }

  // topic → window → signal → user → count
  type Tally = Map<string, number>;
  const tallies = new Map<string, Record<'now' | 'prev', Record<'comments' | 'follows', Tally>>>();
  const bump = (
    topicId: string,
    at: number,
    signal: 'comments' | 'follows',
    userId: string,
  ): void => {
    if (!topicRows.has(topicId) || at > nowMs) return;
    const win = at > nowMs - windowMs ? 'now' : at > nowMs - 2 * windowMs ? 'prev' : null;
    if (!win) return;
    let t = tallies.get(topicId);
    if (!t) {
      t = {
        now: { comments: new Map(), follows: new Map() },
        prev: { comments: new Map(), follows: new Map() },
      };
      tallies.set(topicId, t);
    }
    const m = t[win][signal];
    m.set(userId, (m.get(userId) ?? 0) + 1);
  };
  for (const c of commentRows) {
    const topicId =
      c.entityType === 'topic'
        ? c.entityId
        : c.entityType === 'article'
          ? topicOfArticle.get(c.entityId)
          : undefined;
    if (topicId) bump(topicId, c.createdAt.getTime(), 'comments', c.userId);
  }
  for (const f of followRows) bump(f.entityId, f.createdAt.getTime(), 'follows', f.userId);

  const mass = (m: Map<string, number>): number =>
    cappedCredibleMass(
      [...m.entries()].map(
        ([userId, count]): EngagementByUser => ({
          credibility: cred.get(userId) ?? 0,
          count,
        }),
      ),
      cap,
    );
  for (const [topicId, t] of tallies) {
    result.set(topicId, {
      now: { comments: mass(t.now.comments), follows: mass(t.now.follows) },
      prev: { comments: mass(t.prev.comments), follows: mass(t.prev.follows) },
    });
  }
  return result;
}

interface GameRow {
  subjectId: string;
  gameId: string;
  slug: string;
  name: string;
  status: string;
  releaseDate: string | null;
  upcomingOverride: string | null;
  upcomingFeatured: boolean;
  attrs: RuleLists;
  critics: number | null;
  community: number | null;
  disconnect: number | null;
}

async function loadGames(): Promise<GameRow[]> {
  const rows = await db
    .select({
      subjectId: subjects.id,
      gameId: games.id,
      slug: subjects.slug,
      name: subjects.name,
      status: games.status,
      releaseDate: games.releaseDate,
      upcomingOverride: games.upcomingOverride,
      upcomingFeatured: games.upcomingFeatured,
      genres: games.genres,
      criticsAuto: gameRatingSummaries.criticsScore,
      criticsOverride: gameRatingSummaries.criticsOverride,
      communityAuto: gameRatingSummaries.communityOurScore,
      communityOverride: gameRatingSummaries.communityOverride,
      disconnect: gameRatingSummaries.disconnectValue,
    })
    .from(games)
    .innerJoin(subjects, and(eq(subjects.id, games.subjectId), eq(subjects.type, 'game')))
    .leftJoin(gameRatingSummaries, eq(gameRatingSummaries.gameId, games.id));
  // The rules' `tags` dimension reads PUBLISHED taxonomy tags (Phase P S3), not
  // the raw imported names.
  const tagsByGame = await publishedTagSlugsByGame();
  return rows.map((r) => ({
    subjectId: r.subjectId,
    gameId: r.gameId,
    slug: r.slug,
    name: r.name,
    status: r.status,
    releaseDate: r.releaseDate ?? null,
    upcomingOverride: r.upcomingOverride ?? null,
    upcomingFeatured: r.upcomingFeatured,
    attrs: { genres: r.genres ?? [], tags: tagsByGame.get(r.gameId) ?? [] },
    critics: r.criticsOverride ?? r.criticsAuto ?? null,
    community: r.communityOverride ?? r.communityAuto ?? null,
    disconnect: r.disconnect ?? null,
  }));
}

/** Player-count samples per game in [now − 2w, now], split into the two windows. */
async function loadPlayerWindows(
  windowMs: number,
  nowMs: number,
): Promise<Map<string, { now: number[]; prev: number[] }>> {
  const rows = await db
    .select({
      gameId: gamePlayerCounts.gameId,
      current: gamePlayerCounts.currentPlayers,
      at: gamePlayerCounts.capturedAt,
    })
    .from(gamePlayerCounts)
    .where(gte(gamePlayerCounts.capturedAt, new Date(nowMs - 2 * windowMs)));
  const out = new Map<string, { now: number[]; prev: number[] }>();
  for (const r of rows) {
    if (r.current == null) continue;
    const at = r.at.getTime();
    if (at > nowMs) continue;
    const w = out.get(r.gameId) ?? { now: [], prev: [] };
    (at > nowMs - windowMs ? w.now : w.prev).push(r.current);
    out.set(r.gameId, w);
  }
  return out;
}

async function loadPins(): Promise<
  Map<string, { position: number; ref: string; type: 'topic' | 'game' }[]>
> {
  const rows = await db
    .select({
      sectionId: homepageSectionPins.sectionId,
      position: homepageSectionPins.position,
      topicSlug: homepageSectionPins.topicSlug,
      gameSlug: subjects.slug,
    })
    .from(homepageSectionPins)
    .leftJoin(subjects, eq(subjects.id, homepageSectionPins.subjectId));
  const out = new Map<string, { position: number; ref: string; type: 'topic' | 'game' }[]>();
  for (const r of rows) {
    const ref = r.topicSlug ?? r.gameSlug;
    if (!ref) continue;
    const list = out.get(r.sectionId) ?? [];
    list.push({
      position: r.position,
      ref: `${r.topicSlug ? 't' : 'g'}:${ref}`,
      type: r.topicSlug ? 'topic' : 'game',
    });
    out.set(r.sectionId, list);
  }
  return out;
}

function todayIso(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Compute + store every section's snapshot. Returns the number written. */
export async function computeHomepageSnapshots(now: Date = new Date()): Promise<number> {
  const nowMs = now.getTime();
  const [sections, settings, lists, pins, promotions, gameRows] = await Promise.all([
    listSections(),
    homepageSettings(),
    listsSettings(),
    loadPins(),
    activeSectionPromotions(now),
    loadGames(),
  ]);
  const byKey = new Map(sections.map((s) => [s.key, s]));
  const trendingWindow = (byKey.get('trending')?.deltaWindowHours ?? 48) * HOUR;
  const playersWindow = (byKey.get('by_players')?.deltaWindowHours ?? 168) * HOUR;
  const topicRows = await loadTopics(trendingWindow, nowMs);
  const [engagement, playerWindows] = await Promise.all([
    loadEngagement(topicRows, trendingWindow, nowMs, settings.perUserCap, settings.minCredibility),
    loadPlayerWindows(playersWindow, nowMs),
  ]);
  const topicBySlug = new Map([...topicRows.values()].map((t) => [t.slug, t]));
  const gameBySlug = new Map(gameRows.map((g) => [g.slug, g]));

  const written: SnapshotPayload[] = [];
  const composedRefs = new Map<HomepageSectionKey, string[]>();

  // Dependencies first: Latest excludes Trending; Top rated excludes Games in focus.
  const first: HomepageSectionKey[] = ['trending', 'focus'];
  const order: HomepageSectionKey[] = [
    ...first,
    ...sections.map((s) => s.key).filter((k) => !first.includes(k)),
  ];

  for (const key of order) {
    const s = byKey.get(key);
    if (!s) continue;
    const payload = s.enabled
      ? buildSection(s, {
          settings,
          newWindowDays: lists.newWindowDays,
          pins: pins.get(s.id) ?? [],
          paid: promotions.get(s.id) ?? [],
          topicRows,
          topicBySlug,
          engagement,
          gameRows,
          gameBySlug,
          playerWindows,
          composedRefs,
          nowMs,
        })
      : { key, windowHours: s.deltaWindowHours, items: [] };
    // ORGANIC refs only: a paid insert must never shift what a dependent section
    // excludes (payment never changes data — owner decision B).
    composedRefs.set(
      key,
      payload.items
        .filter((i) => !i.paid)
        .map((i) => `${i.type === 'topic' ? 't' : 'g'}:${i.slug}`),
    );
    written.push(payload);
  }

  for (const p of written) {
    await db
      .insert(homepageSectionSnapshots)
      .values({ sectionKey: p.key, payload: p, computedAt: now })
      .onConflictDoUpdate({
        target: homepageSectionSnapshots.sectionKey,
        set: { payload: p, computedAt: now },
      });
  }
  return written.length;
}

interface BuildCtx {
  settings: HomepageSettings;
  newWindowDays: number;
  pins: { position: number; ref: string; type: 'topic' | 'game' }[];
  /** The section's live paid placements, booking order (first booked → first position). */
  paid: { ref: string; advertiser: string; kind: 'game' | 'story' }[];
  topicRows: Map<string, TopicRow>;
  topicBySlug: Map<string, TopicRow>;
  engagement: Awaited<ReturnType<typeof loadEngagement>>;
  gameRows: GameRow[];
  gameBySlug: Map<string, GameRow>;
  playerWindows: Map<string, { now: number[]; prev: number[] }>;
  composedRefs: Map<HomepageSectionKey, string[]>;
  nowMs: number;
}

function buildSection(s: SectionRow, ctx: BuildCtx): SnapshotPayload {
  const base: SnapshotPayload = {
    key: s.key,
    windowHours: s.delta ? s.deltaWindowHours : null,
    items: [],
  };
  if (s.items === 'none') return base;

  const metrics = new Map<string, { delta: Delta | null; metric: number | null }>();
  let auto: string[];
  const topicPass = (t: TopicRow): boolean => matchesRules(t.attrs, s.rules);
  const gamePass = (g: GameRow): boolean => matchesRules(g.attrs, s.rules);
  const today = todayIso(ctx.nowMs);

  switch (s.key) {
    case 'trending': {
      const w = ctx.settings.trendingWeights;
      const scored = [...ctx.topicRows.values()].map((t) => {
        const e = ctx.engagement.get(t.id);
        const now = trendingScore(
          {
            articles: t.now.articles,
            sources: t.now.sources.size,
            comments: e?.now.comments ?? 0,
            follows: e?.now.follows ?? 0,
          },
          w,
          ctx.settings.maxEngagementShare,
        );
        const prev = trendingScore(
          {
            articles: t.prev.articles,
            sources: t.prev.sources.size,
            comments: e?.prev.comments ?? 0,
            follows: e?.prev.follows ?? 0,
          },
          w,
          ctx.settings.maxEngagementShare,
        );
        // A quiet story (nothing counted in this window) is not trending and carries
        // no Δ — never a "−100%" (owner, S2 review).
        metrics.set(`t:${t.slug}`, {
          delta: now > 0 ? trendingDelta(now, prev) : null,
          metric: now,
        });
        return { t, now };
      });
      // Only stories with activity in THIS window trend (owner, S2 review): no
      // coverage and no counted engagement ⇒ not trending. Fewer qualify → a
      // shorter list; below the section's minimum it is hidden (end of function).
      auto = scored
        .filter((x) => x.now > 0 && topicPass(x.t))
        .sort((a, b) => b.now - a.now || b.t.lastActivity - a.t.lastActivity)
        .map((x) => `t:${x.t.slug}`);
      break;
    }
    case 'latest': {
      const shown = new Set(ctx.composedRefs.get('trending') ?? []);
      auto = [...ctx.topicRows.values()]
        .filter(topicPass)
        .sort((a, b) => b.lastActivity - a.lastActivity)
        .map((t) => `t:${t.slug}`)
        .filter((r) => !shown.has(r));
      break;
    }
    case 'focus': {
      for (const g of ctx.gameRows) {
        if (g.disconnect != null) metrics.set(`g:${g.slug}`, { delta: null, metric: g.disconnect });
      }
      auto = ctx.gameRows
        .filter((g) => g.disconnect != null && gamePass(g))
        .sort((a, b) => (b.disconnect ?? 0) - (a.disconnect ?? 0))
        .map((g) => `g:${g.slug}`);
      break;
    }
    case 'top_rated': {
      // Critic + community layers ONLY (owner decision: the team score stays out
      // of the Top Rated average until S5 switches it on). Distinct from the
      // first three Games in focus.
      const focus = new Set((ctx.composedRefs.get('focus') ?? []).slice(0, 3));
      const rated = ctx.gameRows.map((g) => ({
        g,
        mean: average([g.critics, g.community].filter((n): n is number => n != null)),
      }));
      for (const x of rated) {
        if (x.mean != null)
          metrics.set(`g:${x.g.slug}`, { delta: null, metric: Math.round(x.mean * 10) / 10 });
      }
      auto = rated
        .filter((x) => x.mean != null && gamePass(x.g) && !focus.has(`g:${x.g.slug}`))
        .sort((a, b) => (b.mean ?? 0) - (a.mean ?? 0))
        .map((x) => `g:${x.g.slug}`);
      break;
    }
    case 'by_players': {
      const sampled = ctx.gameRows
        .map((g) => ({ g, w: ctx.playerWindows.get(g.gameId) }))
        .filter((x) => x.w && x.w.now.length > 0)
        .map((x) => ({ ...x, avg: average(x.w!.now) ?? 0 }));
      for (const x of sampled) {
        metrics.set(`g:${x.g.slug}`, {
          delta: playersDelta(x.w!.now, x.w!.prev, ctx.settings.deltaMinPoints),
          metric: Math.round(x.avg),
        });
      }
      auto = sampled
        .filter((x) => gamePass(x.g))
        .sort((a, b) => b.avg - a.avg)
        .map((x) => `g:${x.g.slug}`);
      break;
    }
    case 'new': {
      const since = new Date(ctx.nowMs - ctx.newWindowDays * 86_400_000).toISOString().slice(0, 10);
      auto = ctx.gameRows
        .filter(
          (g) =>
            g.upcomingOverride !== 'hide' &&
            g.status === 'released' &&
            g.releaseDate != null &&
            /^\d{4}-\d{2}-\d{2}$/.test(g.releaseDate) &&
            g.releaseDate <= today &&
            g.releaseDate >= since &&
            gamePass(g),
        )
        .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''))
        .map((g) => `g:${g.slug}`);
      break;
    }
    case 'upcoming': {
      auto = ctx.gameRows
        .filter((g) => {
          if (g.upcomingOverride === 'hide') return false;
          if (
            g.upcomingOverride !== 'show' &&
            !isPreReleaseByStatus(g.status, g.releaseDate, today)
          )
            return false;
          return gamePass(g);
        })
        .sort((a, b) =>
          a.upcomingFeatured !== b.upcomingFeatured
            ? a.upcomingFeatured
              ? -1
              : 1
            : byReleaseThenName(a, b),
        )
        .map((g) => `g:${g.slug}`);
      break;
    }
    default:
      auto = []; // featured / our_picks: editorial pins only
  }

  // Pins of the right item type that still resolve (a stale story pin is skipped).
  const pins = ctx.pins
    .filter((p) => (s.items === 'mixed' ? true : p.type === s.items))
    .filter((p) =>
      p.type === 'topic' ? ctx.topicBySlug.has(p.ref.slice(2)) : ctx.gameBySlug.has(p.ref.slice(2)),
    );
  // Paid inserts that still resolve (a deleted game / re-clustered story is skipped).
  const paid = ctx.paid.filter((x) =>
    x.kind === 'story' ? ctx.topicBySlug.has(x.ref.slice(2)) : ctx.gameBySlug.has(x.ref.slice(2)),
  );
  const composed = composeSection({
    mode: s.mode,
    itemCount: s.itemCount,
    pins,
    auto,
    paid: { positions: s.paidPositions, refs: paid.map((x) => x.ref) },
  });
  base.items = composed.map((c): SnapshotItem => {
    const type = c.ref.startsWith('t:') ? 'topic' : 'game';
    const m = metrics.get(c.ref);
    return {
      type,
      slug: c.ref.slice(2),
      pinned: c.pinned,
      paid:
        c.paid !== null && paid[c.paid]
          ? { advertiser: paid[c.paid]!.advertiser, kind: paid[c.paid]!.kind }
          : null,
      delta: m?.delta ?? null,
      metric: m?.metric ?? null,
    };
  });
  // Hidden when nothing organic qualifies — a paid item never makes a section
  // appear on its own (e.g. an empty Our picks) — and below the section's
  // admin-set minimum (Trending: 3). Pins count: they are the editors' choice.
  const organic = base.items.filter((i) => !i.paid).length;
  if (organic === 0 || (s.minItems != null && organic < s.minItems)) base.items = [];
  return base;
}
