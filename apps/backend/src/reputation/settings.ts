import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { appSettings } from '../db/schema';

/**
 * Reputation / level / badge knobs (SPEC I6, Slice 5, decision 11), admin-tunable
 * via the `reputation` app_setting (the "everything configurable / no hardcoded
 * thresholds" golden rule; same clamp-with-defaults pattern as the rating and
 * community settings). Users NEVER see any of these numbers — only their level
 * name, a progress fraction, and badges (decision 11).
 */
export interface ReputationSettings {
  /** Reputation per unit of a reactor's CREDIBILITY on your comment (the
   *  received-helpful-vote term — weighted so a throwaway ring can't farm it). */
  helpfulWeight: number;
  /** Reputation per accepted report you filed (a report whose target was removed). */
  reportWeight: number;
  /** Reputation per day of account age (tenure), capped. */
  tenureWeightPerDay: number;
  tenureCapDays: number;
  /** Reputation LOST per one of your own comments that was removed. */
  removedPenalty: number;
  /** Which reaction kinds count as a "helpful" received vote. */
  positiveReactions: string[];
  /** Community votes cast to earn the auto "early-voter" badge. */
  earlyVoterVotes: number;
  /** Reputation floor for each level (highest satisfied wins). Newcomer = 0. */
  levelThresholds: { contributor: number; trusted: number; veteran: number; legend: number };
}

export const REPUTATION_SETTINGS_KEY = 'reputation';

export const REPUTATION_DEFAULTS: ReputationSettings = {
  helpfulWeight: 2,
  reportWeight: 3,
  tenureWeightPerDay: 0.1,
  tenureCapDays: 365,
  removedPenalty: 10,
  positiveReactions: ['like', 'insightful'],
  earlyVoterVotes: 5,
  levelThresholds: { contributor: 15, trusted: 60, veteran: 200, legend: 500 },
};

function num(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
}

export async function reputationSettings(): Promise<ReputationSettings> {
  try {
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, REPUTATION_SETTINGS_KEY))
      .limit(1);
    const raw = (row?.value ?? {}) as Record<string, unknown>;
    const d = REPUTATION_DEFAULTS;
    const th = (raw.levelThresholds ?? {}) as Record<string, unknown>;
    const reactions = Array.isArray(raw.positiveReactions)
      ? raw.positiveReactions.filter((r): r is string => typeof r === 'string')
      : null;
    return {
      helpfulWeight: num(raw.helpfulWeight, 0, 1000, d.helpfulWeight),
      reportWeight: num(raw.reportWeight, 0, 1000, d.reportWeight),
      tenureWeightPerDay: num(raw.tenureWeightPerDay, 0, 100, d.tenureWeightPerDay),
      tenureCapDays: num(raw.tenureCapDays, 1, 36_500, d.tenureCapDays),
      removedPenalty: num(raw.removedPenalty, 0, 100_000, d.removedPenalty),
      positiveReactions: reactions && reactions.length > 0 ? reactions : d.positiveReactions,
      earlyVoterVotes: num(raw.earlyVoterVotes, 1, 100_000, d.earlyVoterVotes),
      levelThresholds: {
        contributor: num(th.contributor, 1, 1e9, d.levelThresholds.contributor),
        trusted: num(th.trusted, 1, 1e9, d.levelThresholds.trusted),
        veteran: num(th.veteran, 1, 1e9, d.levelThresholds.veteran),
        legend: num(th.legend, 1, 1e9, d.levelThresholds.legend),
      },
    };
  } catch {
    return REPUTATION_DEFAULTS;
  }
}
