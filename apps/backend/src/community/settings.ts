import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { appSettings } from '../db/schema';

/**
 * Community knobs (SPEC I6, Slice 4) — per-user write rate limits and the
 * comment auto-hide threshold, admin-tunable via the `community` app_setting
 * (the "everything configurable from admin / no hardcoded thresholds" golden
 * rule; same clamp-with-defaults pattern as auth/email settings). Nothing here
 * is hardcoded at a call site.
 */
export interface CommunitySettings {
  /** Max community WRITES per user per window (votes, comments, reactions, …). */
  writesPerUser: number;
  /** Window (seconds) the per-user write counter is measured over. */
  writeWindowSec: number;
  /** Distinct reports on a comment that auto-hide it pending moderator review. */
  autoHideReports: number;
}

export const COMMUNITY_SETTINGS_KEY = 'community';

export const COMMUNITY_DEFAULTS: CommunitySettings = {
  writesPerUser: 60,
  writeWindowSec: 3600,
  autoHideReports: 5,
};

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

export async function communitySettings(): Promise<CommunitySettings> {
  try {
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, COMMUNITY_SETTINGS_KEY))
      .limit(1);
    const raw = (row?.value ?? {}) as Record<string, unknown>;
    return {
      writesPerUser: clampInt(raw.writesPerUser, 1, 100_000, COMMUNITY_DEFAULTS.writesPerUser),
      writeWindowSec: clampInt(raw.writeWindowSec, 60, 86_400, COMMUNITY_DEFAULTS.writeWindowSec),
      autoHideReports: clampInt(raw.autoHideReports, 1, 10_000, COMMUNITY_DEFAULTS.autoHideReports),
    };
  } catch {
    return COMMUNITY_DEFAULTS;
  }
}
