import { eq, isNotNull, or, sql } from 'drizzle-orm';
import type {
  CommunityBurstInfo,
  CredibilityBreakdown,
  DisconnectBand,
} from '@gameskeep/shared/constants';
import { db } from '../db/client';
import {
  gameContentFlags,
  gameDlc,
  gameRatingSummaries,
  games,
  gameUserRatings,
  subjects,
  users,
} from '../db/schema';
import { getRatingSettings } from './rating-settings';
import { computeCredibility, detectBurst, type RatingSettings, type VoteForBurst } from './rating';

/**
 * Read-side rating queries (SPEC I4b inspection surfaces). Shared by the admin
 * routes, the admin UI and the verify script. The DTO models the "data exists?"
 * distinction explicitly (every layer is `{ score, hasData }`) so "no data" is
 * never confused with a score of 0, and I5's "render only where data exists"
 * rule is trivial.
 */

/** One rating layer — `hasData:false` ⇒ no data (NOT a score of 0). */
export interface RatingLayer {
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
    auto: number | null; // weighted (anti-manipulation)
    naive: number | null; // unweighted mean
    override: number | null;
    burstFlag: boolean; // EFFECTIVE (override ?? auto)
    burstFlagAuto: boolean;
    burstInfo: CommunityBurstInfo | null;
  };
  web: RatingLayer;
  disconnect: {
    value: number | null;
    band: DisconnectBand | null;
    contextTag: string | null;
    ourVsCritics: number | null;
    communityVsWeb: number | null;
    hasData: boolean;
  };
  contentFlags: ContentFlagsDTO | null;
  computedAt: string | null;
}

export interface ContentFlagsDTO {
  hasData: true;
  aiAssets: string | null; // null when 'unknown'
  launchState: string | null;
  monetization: {
    microtransactions: boolean;
    battlePass: boolean;
    lootBoxesOrGacha: boolean;
    payToWinPredatory: boolean;
  };
  complexity: number | null;
  notes: string | null;
  dlc: { name: string; priceCents: number | null; currency: string }[];
}

const layer = (score: number | null, count?: number): RatingLayer => ({
  score: score ?? null,
  hasData: score != null,
  count,
});

async function contentFlagsFor(gameId: string): Promise<ContentFlagsDTO | null> {
  const [row] = await db
    .select()
    .from(gameContentFlags)
    .where(eq(gameContentFlags.gameId, gameId))
    .limit(1);
  if (!row) return null; // no flags row ⇒ genuinely no data (distinct from 'unknown')
  const dlc = await db
    .select({ name: gameDlc.name, priceCents: gameDlc.priceCents, currency: gameDlc.currency })
    .from(gameDlc)
    .where(eq(gameDlc.gameId, gameId));
  return {
    hasData: true,
    aiAssets: row.aiAssets === 'unknown' ? null : row.aiAssets,
    launchState: row.launchState === 'unknown' ? null : row.launchState,
    monetization: {
      microtransactions: row.hasMicrotransactions,
      battlePass: row.hasBattlePass,
      lootBoxesOrGacha: row.hasLootBoxesOrGacha,
      payToWinPredatory: row.predatoryMonetization,
    },
    complexity: row.complexityRating ?? null,
    notes: row.notes ?? null,
    dlc: dlc.map((d) => ({ name: d.name, priceCents: d.priceCents ?? null, currency: d.currency })),
  };
}

function shapeSummary(
  g: { gameId: string; name: string; slug: string },
  s: typeof gameRatingSummaries.$inferSelect | undefined,
  flags: ContentFlagsDTO | null,
): AdminGameRating {
  const criticsEff = s?.criticsOverride ?? s?.criticsScore ?? null;
  const communityEff = s?.communityOverride ?? s?.communityOurScore ?? null;
  const burstAuto = s?.communityBurstFlag ?? false;
  const burstEff = s?.burstFlagOverride ?? burstAuto;
  return {
    gameId: g.gameId,
    name: g.name,
    slug: g.slug,
    our: layer(s?.ourScore ?? null),
    critics: {
      ...layer(criticsEff, s?.criticsOutletCount ?? 0),
      auto: s?.criticsScore ?? null,
      override: s?.criticsOverride ?? null,
    },
    community: {
      ...layer(communityEff, s?.communityOurCount ?? 0),
      auto: s?.communityOurScore ?? null,
      naive: s?.communityOurNaiveScore ?? null,
      override: s?.communityOverride ?? null,
      burstFlag: burstEff,
      burstFlagAuto: burstAuto,
      burstInfo: s?.communityBurstInfo ?? null,
    },
    web: layer(s?.communityWebScore ?? null),
    disconnect: {
      value: s?.disconnectValue ?? null,
      band: (s?.disconnectBand as DisconnectBand | null) ?? null,
      contextTag: s?.disconnectContextTag ?? null,
      ourVsCritics: s?.disconnectDetail?.ourVsCritics ?? null,
      communityVsWeb: s?.disconnectDetail?.communityVsWeb ?? null,
      hasData: s?.disconnectValue != null,
    },
    contentFlags: flags,
    computedAt: s?.computedAt ? s.computedAt.toISOString() : null,
  };
}

async function loadGameMeta(
  where: ReturnType<typeof eq>,
): Promise<{ gameId: string; name: string; slug: string } | null> {
  const [row] = await db
    .select({ gameId: games.id, name: subjects.name, slug: subjects.slug })
    .from(games)
    .innerJoin(subjects, eq(games.subjectId, subjects.id))
    .where(where)
    .limit(1);
  return row ?? null;
}

export async function getGameRatingById(gameId: string): Promise<AdminGameRating | null> {
  const meta = await loadGameMeta(eq(games.id, gameId));
  if (!meta) return null;
  const [s] = await db
    .select()
    .from(gameRatingSummaries)
    .where(eq(gameRatingSummaries.gameId, gameId))
    .limit(1);
  return shapeSummary(meta, s, await contentFlagsFor(gameId));
}

export async function getGameRatingBySlug(slug: string): Promise<AdminGameRating | null> {
  const meta = await loadGameMeta(eq(subjects.slug, slug));
  if (!meta) return null;
  return getGameRatingById(meta.gameId);
}

/** Games that carry at least one rating layer — the admin overview + verify list. */
export async function listGameRatings(limit = 300): Promise<AdminGameRating[]> {
  const rows = await db
    .select({
      gameId: games.id,
      name: subjects.name,
      slug: subjects.slug,
      summary: gameRatingSummaries,
    })
    .from(gameRatingSummaries)
    .innerJoin(games, eq(gameRatingSummaries.gameId, games.id))
    .innerJoin(subjects, eq(games.subjectId, subjects.id))
    .where(
      or(
        isNotNull(gameRatingSummaries.ourScore),
        isNotNull(gameRatingSummaries.criticsScore),
        isNotNull(gameRatingSummaries.communityOurScore),
      ),
    )
    .limit(limit);
  const out: AdminGameRating[] = [];
  for (const r of rows) {
    out.push(
      shapeSummary(
        { gameId: r.gameId, name: r.name, slug: r.slug },
        r.summary,
        await contentFlagsFor(r.gameId),
      ),
    );
  }
  return out;
}

// ── per-vote weighting breakdown (SPEC I4b §5 — no opaque number) ────────────
export interface VoteWeightView {
  userId: string;
  username: string | null;
  score: number;
  ratedAt: string;
  credibility: CredibilityBreakdown;
  inWindow: boolean;
  inFlaggedBurst: boolean;
  effectiveWeight: number;
}

/**
 * Show exactly how a game's community aggregate was formed — every vote's
 * credibility (term by term), whether it's in the burst window, and its effective
 * weight after credibility-aware damping. Read-only (recomputes for display).
 */
export async function getGameVoteBreakdown(gameId: string): Promise<{
  votes: VoteWeightView[];
  flagged: boolean;
}> {
  const settings = await getRatingSettings();
  const rows = await db
    .select({
      userId: gameUserRatings.userId,
      username: users.username,
      score: gameUserRatings.score,
      ratedAt: gameUserRatings.ratedAt,
      hasVerifiedPlaytime: gameUserRatings.hasVerifiedPlaytime,
      isEmailVerified: users.isEmailVerified,
      reputation: users.reputation,
      userCreatedAt: users.createdAt,
    })
    .from(gameUserRatings)
    .innerJoin(users, eq(gameUserRatings.userId, users.id))
    .where(eq(gameUserRatings.gameId, gameId));
  if (rows.length === 0) return { votes: [], flagged: false };

  const now = Date.now();
  const enriched = rows
    .map((r) => ({
      ...r,
      credibility: computeCredibility(
        {
          isEmailVerified: r.isEmailVerified,
          reputation: r.reputation,
          accountAgeDays: Math.max(0, (now - r.userCreatedAt.getTime()) / 86_400_000),
          hasVerifiedPlaytime: r.hasVerifiedPlaytime,
        },
        settings.credibility,
      ),
    }))
    .sort((a, b) => a.ratedAt.getTime() - b.ratedAt.getTime());

  const forBurst: VoteForBurst[] = enriched.map((v) => ({ score: v.score, ratedAt: v.ratedAt }));
  const burst = detectBurst(forBurst, settings.burst);

  const votes: VoteWeightView[] = enriched.map((v, i) => {
    const inWindow = burst.inWindow[i] ?? false;
    const inFlaggedBurst = burst.flagged && inWindow;
    const dampMult = inFlaggedBurst
      ? settings.burst.dampingFactor + (1 - settings.burst.dampingFactor) * v.credibility.total
      : 1;
    return {
      userId: v.userId,
      username: v.username,
      score: v.score,
      ratedAt: v.ratedAt.toISOString(),
      credibility: v.credibility,
      inWindow,
      inFlaggedBurst,
      effectiveWeight: Math.round(v.credibility.total * dampMult * 1000) / 1000,
    };
  });
  return { votes, flagged: burst.flagged };
}

export interface RatingStatus {
  settings: RatingSettings;
  counts: { gamesWithSummary: number; gamesWithCommunity: number; gamesFlagged: number };
}

export async function getRatingStatus(): Promise<RatingStatus> {
  const settings = await getRatingSettings();
  const scalar = async (q: ReturnType<typeof sql>): Promise<number> => {
    const res = (await db.execute(q)) as unknown as
      | { rows?: { n: number | string }[] }
      | { n: number | string }[];
    const rows = (Array.isArray(res) ? res : (res.rows ?? [])) as { n: number | string }[];
    return rows[0] ? Number(rows[0].n) : 0;
  };
  const [gamesWithSummary, gamesWithCommunity, gamesFlagged] = await Promise.all([
    scalar(sql`SELECT count(*)::int AS n FROM game_rating_summaries`),
    scalar(
      sql`SELECT count(*)::int AS n FROM game_rating_summaries WHERE community_our_score IS NOT NULL`,
    ),
    scalar(
      sql`SELECT count(*)::int AS n FROM game_rating_summaries WHERE COALESCE(burst_flag_override, community_burst_flag) = true`,
    ),
  ]);
  return { settings, counts: { gamesWithSummary, gamesWithCommunity, gamesFlagged } };
}
