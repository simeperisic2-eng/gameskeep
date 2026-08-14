import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { appSettings } from '../db/schema';

/**
 * Email-flow knobs (SPEC I6, Slice 2) — token TTLs and send throttles, all
 * admin-tunable via the `email` app_setting (the "everything configurable from
 * admin" golden rule; same clamp-with-defaults pattern as the auth lockout and
 * clustering knobs). Nothing here is hardcoded at a call site.
 */
export interface EmailSettings {
  /** Verification-token lifetime (seconds). Locked default 24h. */
  verifyTtlSec: number;
  /** Password-reset-token lifetime (seconds). Locked default 1h. */
  resetTtlSec: number;
  /** Max sends to ONE email address per window (anti-spam of a real inbox). */
  sendMaxPerEmail: number;
  /** Max sends from ONE client IP per window (anti-flood). */
  sendMaxPerIp: number;
  /** Window (seconds) the send counters are measured over. */
  sendWindowSec: number;
}

export const EMAIL_SETTINGS_KEY = 'email';

export const EMAIL_DEFAULTS: EmailSettings = {
  verifyTtlSec: 24 * 60 * 60, // 24h (locked)
  resetTtlSec: 60 * 60, // 1h (locked)
  sendMaxPerEmail: 5,
  sendMaxPerIp: 20,
  sendWindowSec: 60 * 60,
};

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

export async function emailSettings(): Promise<EmailSettings> {
  try {
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, EMAIL_SETTINGS_KEY))
      .limit(1);
    const raw = (row?.value ?? {}) as Record<string, unknown>;
    return {
      verifyTtlSec: clampInt(raw.verifyTtlSec, 300, 7 * 24 * 3600, EMAIL_DEFAULTS.verifyTtlSec),
      resetTtlSec: clampInt(raw.resetTtlSec, 300, 24 * 3600, EMAIL_DEFAULTS.resetTtlSec),
      sendMaxPerEmail: clampInt(raw.sendMaxPerEmail, 1, 1000, EMAIL_DEFAULTS.sendMaxPerEmail),
      sendMaxPerIp: clampInt(raw.sendMaxPerIp, 1, 10_000, EMAIL_DEFAULTS.sendMaxPerIp),
      sendWindowSec: clampInt(raw.sendWindowSec, 60, 86_400, EMAIL_DEFAULTS.sendWindowSec),
    };
  } catch {
    return EMAIL_DEFAULTS;
  }
}
