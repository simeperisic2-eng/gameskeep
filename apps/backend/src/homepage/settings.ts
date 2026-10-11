import { inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { appSettings } from '../db/schema';
import { diffRows, writeAudit, type AuditActor } from '../admin/audit';

/**
 * Homepage, ads and Steam-cadence switches (Phase P S2). Each lives in
 * `app_settings` under its namespace, with an admin control (`/admin/homepage`)
 * and a per-key audit entry; missing / malformed values fall back to defaults.
 *
 *   homepage.deltaMinPoints      samples needed in EACH window for a players Δ
 *   homepage.trendingWeights     coverage / engagement weights of the Trending score
 *   homepage.perUserCap          max units one account adds per signal per story
 *   homepage.minCredibility      accounts below this credibility add nothing
 *   homepage.maxEngagementShare  engagement ≤ this × a story's coverage score
 *   homepage.refreshMinutes      the snapshots job's periodic cadence
 *   ads.showUnsoldPlaceholder    unsold slots render the "AD" box (off → nothing)
 *   steam.sampleEveryHours       production player-count sampling cadence
 */
export interface TrendingWeights {
  articles: number;
  sources: number;
  comments: number;
  follows: number;
}

export interface HomepageSettings {
  deltaMinPoints: number;
  trendingWeights: TrendingWeights;
  perUserCap: number;
  /** Accounts below this 0→1.0 credibility add nothing (a verified email alone = 0.45). */
  minCredibility: number;
  /** Engagement can add at most this × the story's coverage score (0 = coverage only). */
  maxEngagementShare: number;
  refreshMinutes: number;
  showUnsoldPlaceholder: boolean;
  steamSampleEveryHours: number;
}

export const HOMEPAGE_SETTINGS_DEFAULTS: HomepageSettings = {
  deltaMinPoints: 3,
  trendingWeights: { articles: 1, sources: 2, comments: 0.5, follows: 0.5 },
  perUserCap: 1,
  minCredibility: 0.5,
  maxEngagementShare: 1,
  refreshMinutes: 15,
  showUnsoldPlaceholder: false,
  steamSampleEveryHours: 24,
};

const KEYS = { homepage: 'homepage', ads: 'ads', steam: 'steam' } as const;

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {};

function int(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}
function weight(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10 ? v : fallback;
}

function coerce(rows: Map<string, Raw>): HomepageSettings {
  const h = rows.get(KEYS.homepage) ?? {};
  const a = rows.get(KEYS.ads) ?? {};
  const st = rows.get(KEYS.steam) ?? {};
  const w = obj(h.trendingWeights);
  const d = HOMEPAGE_SETTINGS_DEFAULTS;
  return {
    deltaMinPoints: int(h.deltaMinPoints, 1, 50, d.deltaMinPoints),
    trendingWeights: {
      articles: weight(w.articles, d.trendingWeights.articles),
      sources: weight(w.sources, d.trendingWeights.sources),
      comments: weight(w.comments, d.trendingWeights.comments),
      follows: weight(w.follows, d.trendingWeights.follows),
    },
    perUserCap: int(h.perUserCap, 1, 10, d.perUserCap),
    minCredibility:
      typeof h.minCredibility === 'number' && h.minCredibility >= 0 && h.minCredibility <= 1
        ? h.minCredibility
        : d.minCredibility,
    maxEngagementShare:
      typeof h.maxEngagementShare === 'number' &&
      h.maxEngagementShare >= 0 &&
      h.maxEngagementShare <= 5
        ? h.maxEngagementShare
        : d.maxEngagementShare,
    refreshMinutes: int(h.refreshMinutes, 5, 1440, d.refreshMinutes),
    showUnsoldPlaceholder:
      typeof a.showUnsoldPlaceholder === 'boolean'
        ? a.showUnsoldPlaceholder
        : d.showUnsoldPlaceholder,
    steamSampleEveryHours: int(st.sampleEveryHours, 1, 168, d.steamSampleEveryHours),
  };
}

async function readRows(): Promise<Map<string, Raw>> {
  const rows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(inArray(appSettings.key, Object.values(KEYS)));
  return new Map(rows.map((r) => [r.key, obj(r.value)]));
}

export async function homepageSettings(): Promise<HomepageSettings> {
  try {
    return coerce(await readRows());
  } catch {
    // A settings blip falls back to the defaults (placeholders stay hidden).
    return {
      ...HOMEPAGE_SETTINGS_DEFAULTS,
      trendingWeights: { ...HOMEPAGE_SETTINGS_DEFAULTS.trendingWeights },
    };
  }
}

export interface HomepageSettingsPatch {
  deltaMinPoints?: number;
  trendingWeights?: Partial<TrendingWeights>;
  perUserCap?: number;
  minCredibility?: number;
  maxEngagementShare?: number;
  refreshMinutes?: number;
  showUnsoldPlaceholder?: boolean;
  steamSampleEveryHours?: number;
}

/** Patch (only provided fields change); each key written + audited old→new. */
export async function setHomepageSettings(
  patch: HomepageSettingsPatch,
  actor: AuditActor,
): Promise<{ settings: HomepageSettings; changedKeys: string[] }> {
  const rows = await readRows();
  const current = coerce(rows);
  const writes: { key: string; value: Raw }[] = [];

  if (
    patch.deltaMinPoints !== undefined ||
    patch.trendingWeights !== undefined ||
    patch.perUserCap !== undefined ||
    patch.minCredibility !== undefined ||
    patch.maxEngagementShare !== undefined ||
    patch.refreshMinutes !== undefined
  ) {
    writes.push({
      key: KEYS.homepage,
      value: {
        ...(rows.get(KEYS.homepage) ?? {}),
        deltaMinPoints: patch.deltaMinPoints ?? current.deltaMinPoints,
        trendingWeights: { ...current.trendingWeights, ...(patch.trendingWeights ?? {}) },
        perUserCap: patch.perUserCap ?? current.perUserCap,
        minCredibility: patch.minCredibility ?? current.minCredibility,
        maxEngagementShare: patch.maxEngagementShare ?? current.maxEngagementShare,
        refreshMinutes: patch.refreshMinutes ?? current.refreshMinutes,
      },
    });
  }
  if (patch.showUnsoldPlaceholder !== undefined) {
    writes.push({
      key: KEYS.ads,
      value: { ...(rows.get(KEYS.ads) ?? {}), showUnsoldPlaceholder: patch.showUnsoldPlaceholder },
    });
  }
  if (patch.steamSampleEveryHours !== undefined) {
    writes.push({
      key: KEYS.steam,
      value: { ...(rows.get(KEYS.steam) ?? {}), sampleEveryHours: patch.steamSampleEveryHours },
    });
  }

  const changedKeys: string[] = [];
  for (const w of writes) {
    const changes = diffRows(rows.get(w.key) ?? {}, w.value);
    if (Object.keys(changes).length === 0) continue;
    await db
      .insert(appSettings)
      .values({ key: w.key, value: w.value })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: w.value, updatedAt: new Date() },
      });
    await writeAudit({
      action: 'update',
      entityType: 'app-settings',
      entityId: w.key,
      changes,
      summary: `updated homepage settings (${w.key}: ${Object.keys(changes).join(', ')})`,
      actor,
    });
    changedKeys.push(w.key);
  }
  return { settings: coerce(await readRows()), changedKeys };
}
