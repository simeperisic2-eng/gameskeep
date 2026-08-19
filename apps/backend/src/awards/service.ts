import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AwardPhase } from '@gameskeep/shared/constants';
import { db } from '../db/client';
import {
  awardCategories,
  awardEditionCategories,
  awardEditions,
  awardNominations,
  awardOutcomes,
  awardVotes,
  gameRatingSummaries,
  games,
  subjects,
} from '../db/schema';
import { writeAudit, type AuditActor } from '../admin/audit';
import { getRatingSettings } from '../ratings/rating-settings';
import { voterCredibility, type VoterFields } from '../community/weighting';
import { activeSubscriberCount } from './subscribe';

/**
 * Awards voting + outcomes engine (SPEC I7, Slice 1). Voting is a COMMUNITY
 * WRITE and is gated identically at the route (CSRF + verified email + per-user
 * rate limit); this module owns the domain rules:
 *
 *  - a vote is accepted ONLY when the edition is published AND in the `voting`
 *    phase AND inside its window (the "turn it on" switch);
 *  - one vote per (user, edition-category) — a re-vote UPDATES (unique index),
 *    never a duplicate;
 *  - the per-vote WEIGHT is the voter's 0→1.0 credibility (the SAME curve as the
 *    community score) computed at CAST time and frozen in `award_votes.weight`;
 *  - Community Choice = the credibility-weighted winner; Critics' Choice is
 *    AUTO-SUGGESTED from the nominees' critic scores but written insert-if-absent
 *    so a staff confirmation/override is never clobbered by a re-run.
 *
 * Every read here is leak-proof: tallies expose nominee identity + aggregate
 * counts only, never who voted for what.
 */

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** The canonical award lifecycle order — used for forward/backward detection. */
const PHASE_ORDER = ['announce', 'nominations', 'voting', 'reveal', 'archive'] as const;
const phaseIndex = (p: string): number => PHASE_ORDER.indexOf(p as (typeof PHASE_ORDER)[number]);

/**
 * Whether an edition's nominees + live tallies are PUBLIC. Coming-Soon until it is
 * BOTH published AND in a phase where the nominees are meant to be shown (voting
 * onward). This ONE predicate is the single source of visibility truth — used by
 * every public surface (the edition view AND the tally endpoint) so they can never
 * DISAGREE (the classifier/dispatcher bug-class from the I6 review: a pre-voting
 * or unpublished edition must never leak nominees or counts, even via a known
 * category id).
 */
export function isAwardPublic(edition: { isPublished: boolean; phase: string }): boolean {
  return (
    edition.isPublished &&
    (edition.phase === 'voting' || edition.phase === 'reveal' || edition.phase === 'archive')
  );
}

/** The session fields a vote needs (gate + weighting) — same shape as community. */
export type AwardActor = { id: string } & VoterFields;

export type AwardErrorCode =
  | 'unknown_category'
  | 'voting_not_open'
  | 'bad_nomination'
  | 'phase_guard'
  | 'needs_confirm';

/** A typed domain error the route maps to an HTTP status (409/404/400). */
export class AwardError extends Error {
  constructor(
    public readonly code: AwardErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AwardError';
  }
}

interface EditionVotingState {
  editionId: string;
  phase: string;
  isPublished: boolean;
  votingOpensAt: Date | null;
  votingClosesAt: Date | null;
}

/** Resolve the edition that owns an edition-category (or null if unknown). */
async function editionForCategory(editionCategoryId: string): Promise<EditionVotingState | null> {
  const [row] = await db
    .select({
      editionId: awardEditions.id,
      phase: awardEditions.phase,
      isPublished: awardEditions.isPublished,
      votingOpensAt: awardEditions.votingOpensAt,
      votingClosesAt: awardEditions.votingClosesAt,
    })
    .from(awardEditionCategories)
    .innerJoin(awardEditions, eq(awardEditions.id, awardEditionCategories.editionId))
    .where(eq(awardEditionCategories.id, editionCategoryId))
    .limit(1);
  return row ?? null;
}

/** Is the category's edition in a state where its nominees + tally are public? */
export async function categoryIsPublic(editionCategoryId: string): Promise<boolean> {
  const ed = await editionForCategory(editionCategoryId);
  return ed ? isAwardPublic(ed) : false;
}

/** Throws `voting_not_open` unless the edition is published, in-phase, in-window. */
function assertVotingOpen(edition: EditionVotingState, now: Date): void {
  if (!edition.isPublished || edition.phase !== 'voting') {
    throw new AwardError('voting_not_open', 'Voting is not open for this award.');
  }
  const t = now.getTime();
  if (edition.votingOpensAt && t < edition.votingOpensAt.getTime()) {
    throw new AwardError('voting_not_open', 'Voting has not opened yet.');
  }
  if (edition.votingClosesAt && t > edition.votingClosesAt.getTime()) {
    throw new AwardError('voting_not_open', 'Voting has closed.');
  }
}

/**
 * Cast (or change) the actor's vote in an edition-category. Returns the frozen
 * credibility weight. One-per-category integrity is the DB unique index, so a
 * re-vote is a clean upsert, never a read-then-write race.
 */
export async function castVote(
  actor: AwardActor,
  editionCategoryId: string,
  nominationId: string,
  now: Date = new Date(),
): Promise<{ nominationId: string; weight: number }> {
  const edition = await editionForCategory(editionCategoryId);
  if (!edition) throw new AwardError('unknown_category', 'Unknown award category.');
  assertVotingOpen(edition, now);

  // The nomination must belong to THIS category (no cross-category ballot-stuffing).
  const [nom] = await db
    .select({ id: awardNominations.id })
    .from(awardNominations)
    .where(
      and(
        eq(awardNominations.id, nominationId),
        eq(awardNominations.editionCategoryId, editionCategoryId),
      ),
    )
    .limit(1);
  if (!nom) throw new AwardError('bad_nomination', 'That nominee is not in this category.');

  const settings = await getRatingSettings();
  const weight = voterCredibility(actor, settings.credibility, now.getTime());
  await db
    .insert(awardVotes)
    .values({ editionCategoryId, userId: actor.id, nominationId, weight, createdAt: now })
    .onConflictDoUpdate({
      target: [awardVotes.editionCategoryId, awardVotes.userId],
      set: { nominationId, weight, createdAt: now },
    });
  return { nominationId, weight: round3(weight) };
}

/**
 * Retract the actor's vote in a category (idempotent). Gated to the OPEN voting
 * window exactly like `castVote` (SPEC I7, owner security review — finding M1):
 * once voting closes the ballot is FROZEN — no votes added AND none removed — so
 * a decided result cannot be altered after reveal by a voter retracting, and the
 * gate ALSO stops the retract path from returning a tally for a non-public
 * edition (the leak that the GET tally already blocks). Cast and retract now
 * share the same lifecycle guard — no classifier/dispatcher disagreement.
 */
export async function retractVote(
  actor: AwardActor,
  editionCategoryId: string,
  now: Date = new Date(),
): Promise<void> {
  const edition = await editionForCategory(editionCategoryId);
  if (!edition) throw new AwardError('unknown_category', 'Unknown award category.');
  assertVotingOpen(edition, now);
  await db
    .delete(awardVotes)
    .where(
      and(eq(awardVotes.editionCategoryId, editionCategoryId), eq(awardVotes.userId, actor.id)),
    );
}

/** The actor's current vote in a category (or null) — for the "my vote" overlay. */
export async function myVote(
  userId: string,
  editionCategoryId: string,
): Promise<{ nominationId: string } | null> {
  if (!userId) return null;
  const [row] = await db
    .select({ nominationId: awardVotes.nominationId })
    .from(awardVotes)
    .where(and(eq(awardVotes.editionCategoryId, editionCategoryId), eq(awardVotes.userId, userId)))
    .limit(1);
  return row ? { nominationId: row.nominationId } : null;
}

export interface Nominee {
  nominationId: string;
  subjectId: string;
  name: string;
  slug: string;
  blurb: string | null;
  /** Effective critic score (override wins), or null when the game has none. */
  criticsScore: number | null;
}

/** The nominees in a category with their public identity + effective critic score. */
export async function categoryNominees(editionCategoryId: string): Promise<Nominee[]> {
  return db
    .select({
      nominationId: awardNominations.id,
      subjectId: subjects.id,
      name: subjects.name,
      slug: subjects.slug,
      blurb: awardNominations.blurb,
      criticsScore: sql<
        number | null
      >`coalesce(${gameRatingSummaries.criticsOverride}, ${gameRatingSummaries.criticsScore})`,
    })
    .from(awardNominations)
    .innerJoin(subjects, eq(subjects.id, awardNominations.subjectId))
    .leftJoin(games, eq(games.subjectId, subjects.id))
    .leftJoin(gameRatingSummaries, eq(gameRatingSummaries.gameId, games.id))
    .where(eq(awardNominations.editionCategoryId, editionCategoryId));
}

export interface TallyNominee {
  nominationId: string;
  name: string;
  slug: string;
  votes: number;
  weightSum: number;
}
export interface CategoryTally {
  totalVotes: number;
  totalWeight: number;
  nominees: TallyNominee[]; // sorted by weighted mass, then raw votes (desc)
}

/**
 * The credibility-weighted tally for a category — the live counter + ratios.
 * Leak-proof: nominee identity and aggregate counts only, never per-user rows.
 */
export async function categoryTally(editionCategoryId: string): Promise<CategoryTally> {
  const nominees = await categoryNominees(editionCategoryId);
  const rows = await db
    .select({
      nominationId: awardVotes.nominationId,
      weightSum: sql<string>`sum(${awardVotes.weight})`,
      votes: sql<string>`count(*)`,
    })
    .from(awardVotes)
    .where(eq(awardVotes.editionCategoryId, editionCategoryId))
    .groupBy(awardVotes.nominationId);
  const byNom = new Map(
    rows.map((r) => [r.nominationId, { weightSum: Number(r.weightSum), votes: Number(r.votes) }]),
  );

  let totalVotes = 0;
  let totalWeight = 0;
  const merged: TallyNominee[] = nominees.map((n) => {
    const t = byNom.get(n.nominationId) ?? { weightSum: 0, votes: 0 };
    totalVotes += t.votes;
    totalWeight += t.weightSum;
    return {
      nominationId: n.nominationId,
      name: n.name,
      slug: n.slug,
      votes: t.votes,
      weightSum: round3(t.weightSum),
    };
  });
  merged.sort((a, b) => b.weightSum - a.weightSum || b.votes - a.votes);
  return { totalVotes, totalWeight: round3(totalWeight), nominees: merged };
}

export interface CategoryOutcome {
  editionCategoryId: string;
  community: { nominationId: string; weightSum: number; votes: number } | null;
  criticsSuggested: { nominationId: string; criticsScore: number } | null;
  /** false when a staff-set Critics' Choice already existed (not overwritten). */
  criticsWritten: boolean;
}

/**
 * Compute + persist the outcomes for every category in an edition (staff action).
 * Community Choice is upserted (it always reflects the latest votes pre-lock);
 * Critics' Choice is a suggestion written insert-if-absent so a staff
 * confirmation/override survives a re-run. Idempotent; audited.
 */
export async function computeOutcomes(
  editionId: string,
  actor: AuditActor,
): Promise<CategoryOutcome[]> {
  const ecs = await db
    .select({ id: awardEditionCategories.id })
    .from(awardEditionCategories)
    .where(eq(awardEditionCategories.editionId, editionId));

  const summary: CategoryOutcome[] = [];
  for (const ec of ecs) {
    // Community Choice — the credibility-weighted winner (already sorted desc).
    const tally = await categoryTally(ec.id);
    const top = tally.nominees[0];
    const community =
      top && top.votes > 0 && top.weightSum > 0
        ? { nominationId: top.nominationId, weightSum: top.weightSum, votes: top.votes }
        : null;
    if (community) {
      await db
        .insert(awardOutcomes)
        .values({
          editionCategoryId: ec.id,
          outcomeType: 'community',
          nominationId: community.nominationId,
        })
        .onConflictDoUpdate({
          target: [awardOutcomes.editionCategoryId, awardOutcomes.outcomeType],
          set: { nominationId: community.nominationId, updatedAt: new Date() },
        });
    }

    // Critics' Choice — auto-suggested from the highest effective critic score
    // among the nominees (tie → lowest id, deterministic); staff-confirmed.
    const nominees = await categoryNominees(ec.id);
    let criticsSuggested: { nominationId: string; criticsScore: number } | null = null;
    for (const n of nominees) {
      if (n.criticsScore == null) continue;
      if (
        !criticsSuggested ||
        n.criticsScore > criticsSuggested.criticsScore ||
        (n.criticsScore === criticsSuggested.criticsScore &&
          n.nominationId < criticsSuggested.nominationId)
      ) {
        criticsSuggested = { nominationId: n.nominationId, criticsScore: n.criticsScore };
      }
    }
    let criticsWritten = false;
    if (criticsSuggested) {
      const inserted = await db
        .insert(awardOutcomes)
        .values({
          editionCategoryId: ec.id,
          outcomeType: 'critics',
          nominationId: criticsSuggested.nominationId,
        })
        .onConflictDoNothing({
          target: [awardOutcomes.editionCategoryId, awardOutcomes.outcomeType],
        })
        .returning({ id: awardOutcomes.id });
      criticsWritten = inserted.length > 0;
    }

    summary.push({ editionCategoryId: ec.id, community, criticsSuggested, criticsWritten });
  }

  await writeAudit({
    action: 'update',
    entityType: 'award-edition',
    entityId: editionId,
    changes: { computedOutcomes: summary },
    summary: `computed award outcomes (${summary.length} categories)`,
    actor,
  });
  return summary;
}

/**
 * Staff phase transition (SPEC I7, Slice 2; hardened per owner review). Guards:
 *  - opening VOTING is the public "turn it on" — it requires the edition to be
 *    PUBLISHED and to have a voting WINDOW set (voting never opens half-configured);
 *  - entering REVEAL decides the winners (Community from the weighted vote, Critics
 *    auto-suggested); staff can still override any outcome afterwards;
 *  - BACKWARD corrections stay allowed (AUTO + MANUAL OVERRIDE) but are made SAFE:
 *    moving to an EARLIER phase — e.g. reopening a decided vote (reveal → voting)
 *    — requires an explicit `confirm:true`, so it can never happen on a stray
 *    single call. The route is admin-gated (the `awards` admin section = rank 40),
 *    so only admins reach this at all. Every transition is audited.
 */
export async function setEditionPhase(
  editionId: string,
  phase: AwardPhase,
  actor: AuditActor,
  confirm = false,
): Promise<{ phase: string } | null> {
  const [ed] = await db
    .select({
      phase: awardEditions.phase,
      isPublished: awardEditions.isPublished,
      votingOpensAt: awardEditions.votingOpensAt,
      votingClosesAt: awardEditions.votingClosesAt,
    })
    .from(awardEditions)
    .where(eq(awardEditions.id, editionId))
    .limit(1);
  if (!ed) return null;

  // Backward move (to an earlier lifecycle phase) needs explicit confirmation.
  if (phaseIndex(phase) < phaseIndex(ed.phase) && !confirm) {
    throw new AwardError(
      'needs_confirm',
      `Moving an award back from "${ed.phase}" to "${phase}" can reopen a decided vote — resend with confirm:true.`,
    );
  }

  if (phase === 'voting') {
    if (!ed.isPublished) {
      throw new AwardError('phase_guard', 'Publish the edition before opening voting.');
    }
    if (!ed.votingOpensAt || !ed.votingClosesAt) {
      throw new AwardError('phase_guard', 'Set a voting window before opening voting.');
    }
  }

  await db
    .update(awardEditions)
    .set({ phase, updatedAt: new Date() })
    .where(eq(awardEditions.id, editionId));

  if (phase === 'reveal') await computeOutcomes(editionId, actor);

  await writeAudit({
    action: 'update',
    entityType: 'award-edition',
    entityId: editionId,
    changes: { phase: { from: ed.phase, to: phase } },
    summary: `award edition phase → ${phase}`,
    actor,
  });
  return { phase };
}

export interface EditionAnalytics {
  editionId: string;
  phase: string;
  isPublished: boolean;
  totals: { voters: number; votes: number; subscribers: number };
  categories: Array<{
    editionCategoryId: string;
    totalVotes: number;
    totalWeight: number;
    nominees: Array<TallyNominee & { ratio: number }>;
    outcomes: { community: string | null; critics: string | null };
  }>;
  overTime: Array<{ day: string; votes: number }>;
  geo: { available: boolean; note: string; buckets: never[] };
}

/**
 * Aggregated, leak-proof analytics for an edition (SPEC I7, Slice 2): distinct
 * voters, votes, subscriber count, per-category ratios + outcomes, and a
 * votes-over-time series. Geo is aggregated/anonymous only and needs a
 * geolocation provider (production) — structurally present, empty in demo.
 */
export async function editionAnalytics(editionId: string): Promise<EditionAnalytics | null> {
  const [ed] = await db
    .select({ phase: awardEditions.phase, isPublished: awardEditions.isPublished })
    .from(awardEditions)
    .where(eq(awardEditions.id, editionId))
    .limit(1);
  if (!ed) return null;

  const ecs = await db
    .select({ id: awardEditionCategories.id })
    .from(awardEditionCategories)
    .where(eq(awardEditionCategories.editionId, editionId));

  const categories: EditionAnalytics['categories'] = [];
  for (const ec of ecs) {
    const tally = await categoryTally(ec.id);
    const outRows = await db
      .select({ outcomeType: awardOutcomes.outcomeType, nominationId: awardOutcomes.nominationId })
      .from(awardOutcomes)
      .where(eq(awardOutcomes.editionCategoryId, ec.id));
    categories.push({
      editionCategoryId: ec.id,
      totalVotes: tally.totalVotes,
      totalWeight: tally.totalWeight,
      nominees: tally.nominees.map((n) => ({
        ...n,
        ratio: tally.totalWeight > 0 ? round3(n.weightSum / tally.totalWeight) : 0,
      })),
      outcomes: {
        community: outRows.find((o) => o.outcomeType === 'community')?.nominationId ?? null,
        critics: outRows.find((o) => o.outcomeType === 'critics')?.nominationId ?? null,
      },
    });
  }

  const [agg] = await db
    .select({
      voters: sql<string>`count(distinct ${awardVotes.userId})`,
      votes: sql<string>`count(*)`,
    })
    .from(awardVotes)
    .innerJoin(awardEditionCategories, eq(awardEditionCategories.id, awardVotes.editionCategoryId))
    .where(eq(awardEditionCategories.editionId, editionId));

  const overTimeRows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${awardVotes.createdAt}), 'YYYY-MM-DD')`,
      votes: sql<string>`count(*)`,
    })
    .from(awardVotes)
    .innerJoin(awardEditionCategories, eq(awardEditionCategories.id, awardVotes.editionCategoryId))
    .where(eq(awardEditionCategories.editionId, editionId))
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  return {
    editionId,
    phase: ed.phase,
    isPublished: ed.isPublished,
    totals: {
      voters: Number(agg?.voters ?? 0),
      votes: Number(agg?.votes ?? 0),
      subscribers: await activeSubscriberCount('awards'),
    },
    categories,
    overTime: overTimeRows.map((r) => ({ day: r.day, votes: Number(r.votes) })),
    geo: {
      available: false,
      note: 'Aggregated, anonymous geo requires geolocation (production only); not captured in demo.',
      buckets: [],
    },
  };
}

// ── public, phase-aware reads (SPEC I7, Slice 3) ─────────────────────────────

export interface PublicEdition {
  year: number;
  name: string;
  phase: string;
  isPublished: boolean;
  description: string | null;
  votingOpensAt: string | null;
  votingClosesAt: string | null;
  /** True until staff publish — the public page shows "Coming Soon", no nominees. */
  comingSoon: boolean;
}
export interface PublicNominee {
  nominationId: string;
  name: string;
  slug: string;
  blurb: string | null;
  /** The three separated rating layers (leak-proof effective values). */
  scores: { our: number | null; critics: number | null; community: number | null } | null;
  disconnect: { value: number; band: string | null } | null;
  votes: number;
  weightSum: number;
  ratio: number;
  isCommunityWinner: boolean;
  isCriticsWinner: boolean;
}
export interface PublicCategory {
  editionCategoryId: string;
  label: string;
  kind: string;
  sponsor: { label: string; sold: boolean } | null;
  totalVotes: number;
  nominees: PublicNominee[];
}
export interface PublicEditionView {
  edition: PublicEdition;
  categories: PublicCategory[];
}

/** A nominee's three-layer scores + disconnect (the "our better analytics" hook). */
async function nomineeScores(
  subjectId: string,
): Promise<Pick<PublicNominee, 'scores' | 'disconnect'>> {
  const [r] = await db
    .select({
      our: gameRatingSummaries.ourScore,
      criticsAuto: gameRatingSummaries.criticsScore,
      criticsOverride: gameRatingSummaries.criticsOverride,
      communityAuto: gameRatingSummaries.communityOurScore,
      communityOverride: gameRatingSummaries.communityOverride,
      disconnectValue: gameRatingSummaries.disconnectValue,
      disconnectBand: gameRatingSummaries.disconnectBand,
    })
    .from(gameRatingSummaries)
    .innerJoin(games, eq(gameRatingSummaries.gameId, games.id))
    .where(eq(games.subjectId, subjectId))
    .limit(1);
  if (!r) return { scores: null, disconnect: null };
  const critics = r.criticsOverride ?? r.criticsAuto;
  const community = r.communityOverride ?? r.communityAuto;
  const our = r.our ?? null;
  return {
    scores:
      our == null && critics == null && community == null ? null : { our, critics, community },
    disconnect:
      r.disconnectValue != null ? { value: r.disconnectValue, band: r.disconnectBand } : null,
  };
}

/**
 * The leak-proof, phase-aware public view of an edition. Until it is published AND
 * in voting-or-later (`isAwardPublic`) it returns Coming-Soon meta with NO
 * categories — nominees are never exposed before voting opens (the demo default).
 * From voting on it carries each category's nominees with their three scores +
 * disconnect, the live weighted counter, and (after reveal) the Community/Critics
 * winners.
 */
export async function publicEditionView(editionId: string): Promise<PublicEditionView | null> {
  const [ed] = await db
    .select({
      year: awardEditions.year,
      name: awardEditions.name,
      phase: awardEditions.phase,
      isPublished: awardEditions.isPublished,
      description: awardEditions.description,
      votingOpensAt: awardEditions.votingOpensAt,
      votingClosesAt: awardEditions.votingClosesAt,
    })
    .from(awardEditions)
    .where(eq(awardEditions.id, editionId))
    .limit(1);
  if (!ed) return null;

  const edition: PublicEdition = {
    year: ed.year,
    name: ed.name,
    phase: ed.phase,
    isPublished: ed.isPublished,
    description: ed.description ?? null,
    votingOpensAt: ed.votingOpensAt ? ed.votingOpensAt.toISOString() : null,
    votingClosesAt: ed.votingClosesAt ? ed.votingClosesAt.toISOString() : null,
    // Coming-Soon (no nominees) until the edition is published AND in voting or
    // later — a published-but-pre-voting (announce/nominations) edition still
    // shows Coming Soon, so nominees never leak before voting opens.
    comingSoon: !isAwardPublic(ed),
  };
  if (!isAwardPublic(ed)) return { edition, categories: [] };

  const ecs = await db
    .select({
      id: awardEditionCategories.id,
      categoryId: awardEditionCategories.categoryId,
      sponsorSlotLabel: awardEditionCategories.sponsorSlotLabel,
      sponsorSold: awardEditionCategories.sponsorSold,
    })
    .from(awardEditionCategories)
    .where(eq(awardEditionCategories.editionId, editionId))
    .orderBy(awardEditionCategories.sort);

  const catIds = ecs.map((e) => e.categoryId);
  const cats = catIds.length
    ? await db
        .select({
          id: awardCategories.id,
          label: awardCategories.label,
          kind: awardCategories.kind,
        })
        .from(awardCategories)
        .where(inArray(awardCategories.id, catIds))
    : [];
  const catById = new Map(cats.map((c) => [c.id, c]));

  const categories: PublicCategory[] = [];
  for (const ec of ecs) {
    const tally = await categoryTally(ec.id);
    const outRows = await db
      .select({ outcomeType: awardOutcomes.outcomeType, nominationId: awardOutcomes.nominationId })
      .from(awardOutcomes)
      .where(eq(awardOutcomes.editionCategoryId, ec.id));
    const communityWinner =
      outRows.find((o) => o.outcomeType === 'community')?.nominationId ?? null;
    const criticsWinner = outRows.find((o) => o.outcomeType === 'critics')?.nominationId ?? null;

    const noms = await categoryNominees(ec.id);
    const tallyByNom = new Map(tally.nominees.map((n) => [n.nominationId, n]));
    const nominees: PublicNominee[] = [];
    for (const n of noms) {
      const t = tallyByNom.get(n.nominationId);
      const weightSum = t?.weightSum ?? 0;
      const { scores, disconnect } = await nomineeScores(n.subjectId);
      nominees.push({
        nominationId: n.nominationId,
        name: n.name,
        slug: n.slug,
        blurb: n.blurb,
        scores,
        disconnect,
        votes: t?.votes ?? 0,
        weightSum,
        ratio: tally.totalWeight > 0 ? round3(weightSum / tally.totalWeight) : 0,
        isCommunityWinner: communityWinner === n.nominationId,
        isCriticsWinner: criticsWinner === n.nominationId,
      });
    }
    nominees.sort((a, b) => b.weightSum - a.weightSum || a.name.localeCompare(b.name));

    const cat = catById.get(ec.categoryId);
    categories.push({
      editionCategoryId: ec.id,
      label: cat?.label ?? 'Category',
      kind: cat?.kind ?? 'general',
      sponsor: ec.sponsorSlotLabel ? { label: ec.sponsorSlotLabel, sold: ec.sponsorSold } : null,
      totalVotes: tally.totalVotes,
      nominees,
    });
  }
  return { edition, categories };
}

/** The current edition (highest year) — what the public /awards page shows. */
export async function currentEditionView(): Promise<PublicEditionView | null> {
  const [ed] = await db
    .select({ id: awardEditions.id })
    .from(awardEditions)
    .orderBy(desc(awardEditions.year))
    .limit(1);
  return ed ? publicEditionView(ed.id) : null;
}

/** A specific edition by year (archive detail / deep link). */
export async function editionViewByYear(year: number): Promise<PublicEditionView | null> {
  const [ed] = await db
    .select({ id: awardEditions.id })
    .from(awardEditions)
    .where(eq(awardEditions.year, year))
    .limit(1);
  return ed ? publicEditionView(ed.id) : null;
}

/** Published editions in reveal/archive — the permanent archive index. */
export async function listArchive(): Promise<Array<{ year: number; name: string; phase: string }>> {
  return db
    .select({ year: awardEditions.year, name: awardEditions.name, phase: awardEditions.phase })
    .from(awardEditions)
    .where(
      and(eq(awardEditions.isPublished, true), inArray(awardEditions.phase, ['reveal', 'archive'])),
    )
    .orderBy(desc(awardEditions.year));
}

export interface GameAwardWin {
  year: number;
  editionName: string;
  categoryLabel: string;
  outcomeType: string; // 'community' | 'critics'
}

/** Award wins for a game (by slug) — drives the game-page winner badge. Only
 * decided, published editions count (reveal/archive), never a pre-publish draft. */
export async function awardWinsForGame(slug: string): Promise<GameAwardWin[]> {
  return db
    .select({
      year: awardEditions.year,
      editionName: awardEditions.name,
      categoryLabel: awardCategories.label,
      outcomeType: awardOutcomes.outcomeType,
    })
    .from(awardOutcomes)
    .innerJoin(awardNominations, eq(awardNominations.id, awardOutcomes.nominationId))
    .innerJoin(subjects, eq(subjects.id, awardNominations.subjectId))
    .innerJoin(
      awardEditionCategories,
      eq(awardEditionCategories.id, awardOutcomes.editionCategoryId),
    )
    .innerJoin(awardCategories, eq(awardCategories.id, awardEditionCategories.categoryId))
    .innerJoin(awardEditions, eq(awardEditions.id, awardEditionCategories.editionId))
    .where(
      and(
        eq(subjects.slug, slug),
        eq(awardEditions.isPublished, true),
        inArray(awardEditions.phase, ['reveal', 'archive']),
      ),
    )
    .orderBy(desc(awardEditions.year));
}
