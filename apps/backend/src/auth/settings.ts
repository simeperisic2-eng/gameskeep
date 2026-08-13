import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { appSettings } from '../db/schema';

/**
 * Auth anti-abuse knobs (SPEC I6) — admin-tunable via the `auth` app_setting
 * (the "everything configurable from admin" golden rule; same pattern as the
 * clustering knobs and the catalog pageSize). Values are clamped defensively;
 * the defaults below apply when the setting is absent/invalid.
 */
export interface AuthSettings {
  /** Failed logins per ACCOUNT (uid-keyed) before that account locks. */
  userMaxAttempts: number;
  /** Failed logins per client IP before the IP locks (flood guard). */
  ipMaxAttempts: number;
  /** Window (seconds) failures are counted over. */
  windowSec: number;
  /** How long (seconds) a triggered lock lasts. */
  lockSec: number;
}

export const AUTH_SETTINGS_KEY = 'auth';

export const AUTH_DEFAULTS: AuthSettings = {
  userMaxAttempts: 5,
  ipMaxAttempts: 30,
  windowSec: 900,
  lockSec: 900,
};

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

export async function authSettings(): Promise<AuthSettings> {
  try {
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, AUTH_SETTINGS_KEY))
      .limit(1);
    const raw = (row?.value ?? {}) as Record<string, unknown>;
    return {
      userMaxAttempts: clampInt(raw.userMaxAttempts, 3, 100, AUTH_DEFAULTS.userMaxAttempts),
      ipMaxAttempts: clampInt(raw.ipMaxAttempts, 10, 10_000, AUTH_DEFAULTS.ipMaxAttempts),
      windowSec: clampInt(raw.windowSec, 60, 86_400, AUTH_DEFAULTS.windowSec),
      lockSec: clampInt(raw.lockSec, 60, 86_400, AUTH_DEFAULTS.lockSec),
    };
  } catch {
    return AUTH_DEFAULTS;
  }
}
