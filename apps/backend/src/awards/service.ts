import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
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

/** The session fields a vote needs (gate + weighting) — same shape as community. */
export type AwardActor = { id: string } & VoterFields;

export type AwardErrorCode = 'unknown_category' | 'voting_not_open' | 'bad_nomination';

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

/** Retract the actor's vote in a category (idempotent). */
export async function retractVote(actor: AwardActor, editionCategoryId: string): Promise<void> {
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
