import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import {
  gameCriticReviews,
  gameExternalRatings,
  gameRatingSummaries,
  gameReviews,
  games,
  gameUserRatings,
  users,
} from '../db/schema';
import { writeAudit, type AuditActor } from '../admin/audit';
import {
  aggregateCommunity,
  computeCredibility,
  detectBurst,
  disconnectBandFor,
  gap,
  normalizeCriticScore,
  toBurstInfo,
  type RatingSettings,
  type VoteForBurst,
  type WeightedVote,
} from './rating';
import { getRatingSettings } from './rating-settings';

/**
 * The rating engine's DB-side operations (SPEC I4b). All heavy work runs in the
 * background (boot + admin trigger) and is stored — users read pre-computed
 * summaries (CLAUDE.md speed rule). Re-tuning recomputes the AUTO layers + flags
 * but NEVER an editor override (auto + manual override rule). A game with no
 * data computes a summary of NULLS — never a crash, never a fabricated number.
 */

export interface RecomputeResult {
  gamesProcessed: number;
}

const MS_PER_DAY = 86_400_000;

interface OurResult {
  ourScore: number | null;
}
async function loadOur(gameId: string): Promise<OurResult> {
  const [row] = await db
    .select({ ourScore: gameReviews.ourScore })
    .from(gameReviews)
    .where(eq(gameReviews.gameId, gameId))
    .limit(1);
  return { ourScore: row?.ourScore ?? null };
}

async function loadCritics(gameId: string): Promise<{ score: number | null; count: number }> {
  const rows = await db
    .select({
      score: gameCriticReviews.score,
      nativeScore: gameCriticReviews.nativeScore,
      nativeScaleMax: gameCriticReviews.nativeScaleMax,
    })
    .from(gameCriticReviews)
    .where(eq(gameCriticReviews.gameId, gameId));
  if (rows.length === 0) return { score: null, count: 0 };
  const normalized = rows.map((r) =>
    normalizeCriticScore(r.score, r.nativeScore ?? null, r.nativeScaleMax ?? null),
  );
  const mean = normalized.reduce((a, b) => a + b, 0) / normalized.length;
  return { score: Math.round(mean), count: rows.length };
}

async function loadWeb(gameId: string): Promise<number | null> {
  // Prefer a Steam estimate; fall back to any external rating with a score/sentiment.
  const rows = await db
    .select({
      kind: gameExternalRatings.kind,
      score: gameExternalRatings.score,
      sentimentPct: gameExternalRatings.sentimentPct,
    })
    .from(gameExternalRatings)
    .where(eq(gameExternalRatings.gameId, gameId));
  if (rows.length === 0) return null;
  const steam = rows.find((r) => r.kind === 'steam') ?? rows[0]!;
  if (steam.score != null) return steam.score;
  if (steam.sentimentPct != null) return Math.round(steam.sentimentPct);
  return null;
}

interface CommunityResult {
  weighted: number | null;
  naive: number | null;
  count: number;
  burstFlag: boolean;
  burstInfo: ReturnType<typeof toBurstInfo> | null;
}

/**
 * Compute the weighted community score: store each vote's credibility weight,
 * detect a burst, aggregate with credibility-aware damping. The same time-sorted
 * vote set feeds the burst detector and the aggregator so `inWindow` aligns.
 */
async function computeCommunity(
  gameId: string,
  settings: RatingSettings,
): Promise<CommunityResult> {
  const rows = await db
    .select({
      id: gameUserRatings.id,
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

  if (rows.length === 0) {
    return { weighted: null, naive: null, count: 0, burstFlag: false, burstInfo: null };
  }

  const now = Date.now();
  // Compute credibility per vote (and persist it on the vote's weight column).
  const enriched = rows
    .map((r) => {
      const cred = computeCredibility(
        {
          isEmailVerified: r.isEmailVerified,
          reputation: r.reputation,
          accountAgeDays: Math.max(0, (now - r.userCreatedAt.getTime()) / MS_PER_DAY),
          hasVerifiedPlaytime: r.hasVerifiedPlaytime,
        },
        settings.credibility,
      );
      return { id: r.id, score: r.score, ratedAt: r.ratedAt, credibility: cred.total };
    })
    .sort((a, b) => a.ratedAt.getTime() - b.ratedAt.getTime());

  // Persist the stored per-vote weight (inspectable; queryable).
  for (const v of enriched) {
    await db
      .update(gameUserRatings)
      .set({ weight: v.credibility })
      .where(eq(gameUserRatings.id, v.id));
  }

  const forBurst: VoteForBurst[] = enriched.map((v) => ({ score: v.score, ratedAt: v.ratedAt }));
  const weighted: WeightedVote[] = enriched.map((v) => ({
    score: v.score,
    credibility: v.credibility,
    ratedAt: v.ratedAt,
  }));

  const burst = detectBurst(forBurst, settings.burst);
  const agg = aggregateCommunity(weighted, burst, settings.burst);

  return {
    weighted: agg.weighted,
    naive: agg.naive,
    count: agg.count,
    burstFlag: burst.flagged,
    burstInfo: toBurstInfo(burst, agg),
  };
}

/** Recompute one game's stored rating summary (auto layers + disconnect). */
export async function recomputeGameRating(gameId: string): Promise<void> {
  const settings = await getRatingSettings();

  // Existing overrides must survive a re-tune — read them to compute the
  // EFFECTIVE disconnect, but never overwrite them below.
  const [existing] = await db
    .select({
      criticsOverride: gameRatingSummaries.criticsOverride,
      communityOverride: gameRatingSummaries.communityOverride,
    })
    .from(gameRatingSummaries)
    .where(eq(gameRatingSummaries.gameId, gameId))
    .limit(1);

  const our = await loadOur(gameId);
  const critics = await loadCritics(gameId);
  const community = await computeCommunity(gameId, settings);
  const webScore = await loadWeb(gameId);

  const criticsEff = existing?.criticsOverride ?? critics.score;
  const communityEff = existing?.communityOverride ?? community.weighted;

  const disconnectValue = gap(criticsEff, communityEff);
  const disconnectBand =
    disconnectValue == null ? null : disconnectBandFor(disconnectValue, settings.disconnect);
  const disconnectDetail = {
    ourVsCritics: gap(our.ourScore, criticsEff),
    communityVsWeb: gap(communityEff, webScore),
  };

  // AUTO columns only — override columns are deliberately omitted from the upsert.
  const autoValues = {
    ourScore: our.ourScore,
    criticsScore: critics.score,
    criticsOutletCount: critics.count,
    communityOurScore: community.weighted,
    communityOurNaiveScore: community.naive,
    communityOurCount: community.count,
    communityWebScore: webScore,
    communityBurstFlag: community.burstFlag,
    communityBurstInfo: community.burstInfo,
    disconnectValue,
    disconnectBand,
    disconnectDetail,
    computedAt: new Date(),
  };

  await db
    .insert(gameRatingSummaries)
    .values({ gameId, ...autoValues })
    .onConflictDoUpdate({ target: gameRatingSummaries.gameId, set: autoValues });
}

/** Recompute every game's rating summary (background; idempotent). */
export async function recomputeAllRatings(): Promise<RecomputeResult> {
  const rows = await db.select({ id: games.id }).from(games);
  let processed = 0;
  for (const g of rows) {
    try {
      await recomputeGameRating(g.id);
      processed += 1;
    } catch {
      // One bad game must never abort the whole recompute (anti-bug rule).
    }
  }
  return { gamesProcessed: processed };
}

// ── editor controls (auto + manual override, all audit-logged) ───────────────

export interface RatingOverridePatch {
  criticsScore?: number | null;
  communityScore?: number | null;
  reason?: string;
}

/** Override the critics and/or community aggregate (auto kept underneath; audited). */
export async function setRatingOverride(
  gameId: string,
  patch: RatingOverridePatch,
  actor: AuditActor,
): Promise<boolean> {
  const [before] = await db
    .select({
      criticsOverride: gameRatingSummaries.criticsOverride,
      communityOverride: gameRatingSummaries.communityOverride,
    })
    .from(gameRatingSummaries)
    .where(eq(gameRatingSummaries.gameId, gameId))
    .limit(1);
  if (!before) return false;

  const set: Record<string, unknown> = {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const reason = patch.reason?.slice(0, 2000) ?? null;
  if (patch.criticsScore !== undefined) {
    set.criticsOverride = patch.criticsScore;
    set.criticsOverrideReason = patch.criticsScore === null ? null : reason;
    changes.criticsOverride = { from: before.criticsOverride, to: patch.criticsScore };
  }
  if (patch.communityScore !== undefined) {
    set.communityOverride = patch.communityScore;
    set.communityOverrideReason = patch.communityScore === null ? null : reason;
    changes.communityOverride = { from: before.communityOverride, to: patch.communityScore };
  }
  if (Object.keys(set).length === 0) return false;

  await db.update(gameRatingSummaries).set(set).where(eq(gameRatingSummaries.gameId, gameId));
  // Disconnect depends on the effective scores → refresh it (doesn't clobber overrides).
  await recomputeGameRating(gameId);
  await writeAudit({
    action: 'update',
    entityType: 'game-rating-summaries',
    entityId: gameId,
    changes: { ...changes, reason },
    summary: `rating override (${Object.keys(changes).join(', ') || 'none'})`,
    actor,
  });
  return true;
}

/** Force / clear the community burst flag (transparency override). `null` = use auto. */
export async function setBurstFlagOverride(
  gameId: string,
  flagged: boolean | null,
  reason: string | undefined,
  actor: AuditActor,
): Promise<boolean> {
  const [before] = await db
    .select({ burstFlagOverride: gameRatingSummaries.burstFlagOverride })
    .from(gameRatingSummaries)
    .where(eq(gameRatingSummaries.gameId, gameId))
    .limit(1);
  if (!before) return false;
  await db
    .update(gameRatingSummaries)
    .set({
      burstFlagOverride: flagged,
      burstFlagOverrideReason: flagged === null ? null : (reason?.slice(0, 2000) ?? null),
    })
    .where(eq(gameRatingSummaries.gameId, gameId));
  await writeAudit({
    action: 'update',
    entityType: 'game-rating-summaries',
    entityId: gameId,
    changes: { burstFlagOverride: { from: before.burstFlagOverride, to: flagged }, reason },
    summary: 'community burst flag override',
    actor,
  });
  return true;
}

/**
 * Set/clear the disconnect CONTEXT TAG (SPEC I4b §2) — the judgmental "why the
 * gap exists". EDITOR-ENTERED ONLY; never auto-inferred. Audit-logged.
 */
export async function setDisconnectTag(
  gameId: string,
  contextTag: string | null,
  actor: AuditActor,
): Promise<boolean> {
  const [before] = await db
    .select({ disconnectContextTag: gameRatingSummaries.disconnectContextTag })
    .from(gameRatingSummaries)
    .where(eq(gameRatingSummaries.gameId, gameId))
    .limit(1);
  if (!before) return false;
  await db
    .update(gameRatingSummaries)
    .set({ disconnectContextTag: contextTag?.slice(0, 200) ?? null })
    .where(eq(gameRatingSummaries.gameId, gameId));
  await writeAudit({
    action: 'update',
    entityType: 'game-rating-summaries',
    entityId: gameId,
    changes: {
      disconnectContextTag: { from: before.disconnectContextTag, to: contextTag ?? null },
    },
    summary: 'set disconnect context tag',
    actor,
  });
  return true;
}
