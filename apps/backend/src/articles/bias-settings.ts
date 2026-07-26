import { eq } from 'drizzle-orm';
import { BIAS_WEIGHT_DEFAULTS } from '@gameskeep/shared/constants';
import { db } from '../db/client';
import { appSettings } from '../db/schema';
import { writeAudit, type AuditActor } from '../admin/audit';

/**
 * Transparent additive BIAS WEIGHTS store (SPEC I4a §1/§2; CLAUDE.md "everything
 * configurable from admin, no hardcoded weights"). Every point on each axis comes
 * from one of these NAMED weights — no black box. Persisted in `app_settings`
 * under `bias-weights`, with the shared seed defaults as the fallback; changes are
 * audit-logged. Re-tuning a weight here changes the AUTO scores on the next
 * recompute, but never touches an editor override (SPEC I4a §6).
 */
export const BIAS_SETTINGS_KEY = 'bias-weights';

export interface InfluenceWeights {
  sourceBaselineMax: number;
  sponsored: number;
  sourceConflict: number;
  affiliate: number;
  opinionFraming: number;
  reviewCopy: number;
  paywall: number;
}

export interface QualityWeights {
  baselineMid: number;
  sourceReputationMax: number;
  neutralDefault: number;
  typeReview: number;
  typeOpinion: number;
  typePreview: number;
  typeGuide: number;
  typeNews: number;
  sponsored: number;
  affiliate: number;
}

export interface BiasBuckets {
  influenceMidpoint: number;
  qualityMidpoint: number;
}

export interface BiasWeights {
  influence: InfluenceWeights;
  quality: QualityWeights;
  buckets: BiasBuckets;
}

export type BiasWeightsPatch = {
  influence?: Record<string, number>;
  quality?: Record<string, number>;
  buckets?: Partial<BiasBuckets>;
};

/** Read each known numeric key from `stored`, falling back to `defaults`. */
function mergeNumeric<T extends Record<string, number>>(defaults: T, stored: unknown): T {
  const obj = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const out = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof T & string)[]) {
    const v = obj[key];
    // Weights are bounded; final scores are clamped 0..100 by the compute fn.
    if (typeof v === 'number' && Number.isFinite(v) && v >= -100 && v <= 100) {
      out[key] = v as T[keyof T & string];
    }
  }
  return out;
}

function coerceBuckets(stored: unknown): BiasBuckets {
  const obj = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const clamp = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? Math.round(v) : fallback;
  return {
    influenceMidpoint: clamp(obj.influenceMidpoint, BIAS_WEIGHT_DEFAULTS.buckets.influenceMidpoint),
    qualityMidpoint: clamp(obj.qualityMidpoint, BIAS_WEIGHT_DEFAULTS.buckets.qualityMidpoint),
  };
}

function coerce(raw: unknown): BiasWeights {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    influence: mergeNumeric(BIAS_WEIGHT_DEFAULTS.influence, obj.influence),
    quality: mergeNumeric(BIAS_WEIGHT_DEFAULTS.quality, obj.quality),
    buckets: coerceBuckets(obj.buckets),
  };
}

export async function getBiasWeights(): Promise<BiasWeights> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, BIAS_SETTINGS_KEY))
    .limit(1);
  return coerce(row?.value);
}

/** Patch the weights (deep-merge of provided fields only) and audit the diff. */
export async function setBiasWeights(
  patch: BiasWeightsPatch,
  actor: AuditActor,
): Promise<BiasWeights> {
  const current = await getBiasWeights();
  const next = coerce({
    influence: { ...current.influence, ...(patch.influence ?? {}) },
    quality: { ...current.quality, ...(patch.quality ?? {}) },
    buckets: { ...current.buckets, ...(patch.buckets ?? {}) },
  });
  const value = next as unknown as Record<string, unknown>;
  await db
    .insert(appSettings)
    .values({ key: BIAS_SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  await writeAudit({
    action: 'update',
    entityType: 'app-settings',
    entityId: BIAS_SETTINGS_KEY,
    changes: { from: current, to: next },
    summary: 'updated bias weights',
    actor,
  });
  return next;
}
