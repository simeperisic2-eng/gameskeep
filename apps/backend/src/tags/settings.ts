import { eq } from 'drizzle-orm';
import type { TagSettingsPatch } from '@gameskeep/shared/validation';
import { db } from '../db/client';
import { appSettings } from '../db/schema';
import { writeAudit, type AuditActor } from '../admin/audit';

/**
 * Tag settings (Phase P S3) — app_settings `tags`, clamp-with-defaults on read
 * and per-key audit on write, like every settings module. Every product choice
 * the slice makes is a knob here (owner: "everything admin-set").
 */
export interface TagSettings {
  /** A player-reported tag waits for this credibility-weighted score (Σ credibility). */
  publishThreshold: number;
  /** Votes from accounts below this credibility count 0 toward the score. */
  minCredibility: number;
  /** Vote-driven issue tags turn "Past issue" after this many days without fresh signal. */
  issueExpiryDays: number;
  /** A tag page is indexable + in the sitemap only with this many published games. */
  indexMinGames: number;
  /** Show "Unusual voting activity" on a published flagged tag (owner: default OFF). */
  showAnomalyLabel: boolean;
  /** Tags shown on a catalog card. */
  catalogCardCount: number;
  /** Spike detection: the window, the minimum votes in it and the multiplier vs history. */
  burstWindowHours: number;
  burstMinVotes: number;
  burstMultiplier: number;
  /** A spike is flagged when at least this share of its votes are low-credibility. */
  lowCredibilityShare: number;
  /** Quick-view data cache (seconds; 0 = no cache). */
  quickViewCacheSeconds: number;
}

export const TAG_SETTINGS_KEY = 'tags';

export const TAG_SETTINGS_DEFAULTS: TagSettings = {
  publishThreshold: 3,
  minCredibility: 0.5,
  issueExpiryDays: 60,
  indexMinGames: 5,
  showAnomalyLabel: false,
  catalogCardCount: 3,
  burstWindowHours: 24,
  burstMinVotes: 5,
  burstMultiplier: 3,
  lowCredibilityShare: 0.6,
  quickViewCacheSeconds: 300,
};

const num = (v: unknown, min: number, max: number, d: number, int = false): number =>
  typeof v === 'number' &&
  Number.isFinite(v) &&
  v >= min &&
  v <= max &&
  (!int || Number.isInteger(v))
    ? v
    : d;

export function coerceTagSettings(raw: unknown): TagSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = TAG_SETTINGS_DEFAULTS;
  return {
    publishThreshold: num(o.publishThreshold, 0.5, 1000, d.publishThreshold),
    minCredibility: num(o.minCredibility, 0, 1, d.minCredibility),
    issueExpiryDays: num(o.issueExpiryDays, 1, 3650, d.issueExpiryDays, true),
    indexMinGames: num(o.indexMinGames, 1, 1000, d.indexMinGames, true),
    showAnomalyLabel:
      typeof o.showAnomalyLabel === 'boolean' ? o.showAnomalyLabel : d.showAnomalyLabel,
    catalogCardCount: num(o.catalogCardCount, 0, 10, d.catalogCardCount, true),
    burstWindowHours: num(o.burstWindowHours, 1, 720, d.burstWindowHours, true),
    burstMinVotes: num(o.burstMinVotes, 2, 1000, d.burstMinVotes, true),
    burstMultiplier: num(o.burstMultiplier, 1, 100, d.burstMultiplier),
    lowCredibilityShare: num(o.lowCredibilityShare, 0, 1, d.lowCredibilityShare),
    quickViewCacheSeconds: num(o.quickViewCacheSeconds, 0, 86_400, d.quickViewCacheSeconds, true),
  };
}

export async function tagSettings(): Promise<TagSettings> {
  try {
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, TAG_SETTINGS_KEY))
      .limit(1);
    return coerceTagSettings(row?.value);
  } catch {
    return { ...TAG_SETTINGS_DEFAULTS };
  }
}

export async function setTagSettings(
  patch: TagSettingsPatch,
  actor: AuditActor,
): Promise<TagSettings> {
  const current = await tagSettings();
  const next = coerceTagSettings({ ...current, ...patch });
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(next) as (keyof TagSettings)[]) {
    if (next[k] !== current[k]) changes[k] = { from: current[k], to: next[k] };
  }
  if (Object.keys(changes).length === 0) return next;
  const value = next as unknown as Record<string, unknown>;
  await db
    .insert(appSettings)
    .values({ key: TAG_SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  await writeAudit({
    action: 'update',
    entityType: 'app-settings',
    entityId: TAG_SETTINGS_KEY,
    changes,
    summary: `tag settings: ${Object.keys(changes).join(', ')}`,
    actor,
  });
  return next;
}
