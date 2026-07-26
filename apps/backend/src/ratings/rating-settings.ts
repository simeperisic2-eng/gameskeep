import { eq } from 'drizzle-orm';
import { RATING_WEIGHT_DEFAULTS } from '@gameskeep/shared/constants';
import { db } from '../db/client';
import { appSettings } from '../db/schema';
import { writeAudit, type AuditActor } from '../admin/audit';
import type { RatingSettings } from './rating';

/**
 * Rating-engine settings store (SPEC I4b; CLAUDE.md "everything configurable, no
 * hardcoded thresholds"). Persisted in `app_settings` under `ratings`, with the
 * shared seed defaults as the fallback; every change is audit-logged. Re-tuning
 * here changes the AUTO scores/flags on the next recompute, but never an editor
 * override (the I4a override-safe pattern).
 */
export const RATING_SETTINGS_KEY = 'ratings';

export type RatingSettingsPatch = {
  credibility?: Record<string, number>;
  burst?: Record<string, number>;
  disconnect?: Record<string, number>;
};

function mergeNumeric<T extends Record<string, number>>(defaults: T, stored: unknown): T {
  const obj = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const out = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof T & string)[]) {
    const v = obj[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      out[key] = v as T[keyof T & string];
    }
  }
  return out;
}

function coerce(raw: unknown): RatingSettings {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    credibility: mergeNumeric(RATING_WEIGHT_DEFAULTS.credibility, obj.credibility),
    burst: mergeNumeric(RATING_WEIGHT_DEFAULTS.burst, obj.burst),
    disconnect: mergeNumeric(RATING_WEIGHT_DEFAULTS.disconnect, obj.disconnect),
  };
}

export async function getRatingSettings(): Promise<RatingSettings> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, RATING_SETTINGS_KEY))
    .limit(1);
  return coerce(row?.value);
}

/** Patch the rating settings (deep-merge of provided fields only); audit the diff. */
export async function setRatingSettings(
  patch: RatingSettingsPatch,
  actor: AuditActor,
): Promise<RatingSettings> {
  const current = await getRatingSettings();
  const next = coerce({
    credibility: { ...current.credibility, ...(patch.credibility ?? {}) },
    burst: { ...current.burst, ...(patch.burst ?? {}) },
    disconnect: { ...current.disconnect, ...(patch.disconnect ?? {}) },
  });
  const value = next as unknown as Record<string, unknown>;
  await db
    .insert(appSettings)
    .values({ key: RATING_SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  await writeAudit({
    action: 'update',
    entityType: 'app-settings',
    entityId: RATING_SETTINGS_KEY,
    changes: { from: current, to: next },
    summary: 'updated rating-engine settings',
    actor,
  });
  return next;
}
