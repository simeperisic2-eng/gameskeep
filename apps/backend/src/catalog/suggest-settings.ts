import { eq } from 'drizzle-orm';
import type { SuggestSettingsPatch } from '@gameskeep/shared/validation';
import { db } from '../db/client';
import { appSettings } from '../db/schema';
import { writeAudit, type AuditActor } from '../admin/audit';

/**
 * Rate limits of the public "Suggest a missing game" form (S2 review: they were
 * constants in code). app_settings `suggest`; clamp-with-defaults on read,
 * per-key audit on write, like every settings module. Read on every suggestion,
 * so a change applies to the next request.
 */
export interface SuggestSettings {
  /** Suggestions one IP may file per window. */
  perIpMax: number;
  /** Suggestions across all IPs per window. */
  globalMax: number;
  /** The sliding window, in minutes. */
  windowMinutes: number;
}

export const SUGGEST_SETTINGS_KEY = 'suggest';
export const SUGGEST_DEFAULTS: SuggestSettings = { perIpMax: 5, globalMax: 60, windowMinutes: 10 };

const LIMITS = {
  perIpMax: [1, 1000],
  globalMax: [1, 100_000],
  windowMinutes: [1, 1440],
} as const satisfies Record<keyof SuggestSettings, readonly [number, number]>;

function clampInt(v: unknown, [min, max]: readonly [number, number], fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

export function coerceSuggestSettings(raw: unknown): SuggestSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    perIpMax: clampInt(o.perIpMax, LIMITS.perIpMax, SUGGEST_DEFAULTS.perIpMax),
    globalMax: clampInt(o.globalMax, LIMITS.globalMax, SUGGEST_DEFAULTS.globalMax),
    windowMinutes: clampInt(o.windowMinutes, LIMITS.windowMinutes, SUGGEST_DEFAULTS.windowMinutes),
  };
}

export async function suggestSettings(): Promise<SuggestSettings> {
  try {
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, SUGGEST_SETTINGS_KEY))
      .limit(1);
    return coerceSuggestSettings(row?.value);
  } catch {
    return { ...SUGGEST_DEFAULTS };
  }
}

/** A setting combination that can't work (rejected with 400, nothing written). */
export class SuggestSettingsError extends Error {}

export async function setSuggestSettings(
  patch: SuggestSettingsPatch,
  actor: AuditActor,
): Promise<SuggestSettings> {
  const current = await suggestSettings();
  const next: SuggestSettings = {
    perIpMax: patch.perIpMax ?? current.perIpMax,
    globalMax: patch.globalMax ?? current.globalMax,
    windowMinutes: patch.windowMinutes ?? current.windowMinutes,
  };
  if (next.perIpMax > next.globalMax) {
    throw new SuggestSettingsError(
      `The per-IP limit (${next.perIpMax}) can't exceed the overall limit (${next.globalMax}).`,
    );
  }
  const changes: Record<string, { from: number; to: number }> = {};
  for (const k of Object.keys(next) as (keyof SuggestSettings)[]) {
    if (next[k] !== current[k]) changes[k] = { from: current[k], to: next[k] };
  }
  if (Object.keys(changes).length === 0) return next;
  const value = next as unknown as Record<string, unknown>;
  await db
    .insert(appSettings)
    .values({ key: SUGGEST_SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  await writeAudit({
    action: 'update',
    entityType: 'app-settings',
    entityId: SUGGEST_SETTINGS_KEY,
    changes,
    summary: `suggest limits: ${next.perIpMax}/IP, ${next.globalMax} overall per ${next.windowMinutes} min`,
    actor,
  });
  return next;
}
