import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { appSettings } from '../db/schema';
import { writeAudit, type AuditActor } from '../admin/audit';

/**
 * Homepage list / ranking configuration (SPEC I8, Slice 4; BLUEPRINT §3.9 + the
 * "everything configurable from admin; no hardcoded lists/rankings" golden rule).
 * Every homepage rail size + the manual pins live in the `lists` app_setting —
 * nothing is hardcoded at the composition site. AUTO + MANUAL OVERRIDE: the rails
 * still compute automatically (coverage / score / disconnect), and staff can pin
 * specific stories/games to the top and auto-surface promoted games — the
 * automation runs untouched underneath the pins. Same clamp-with-defaults +
 * audit-on-write pattern as the clustering / community / rbac settings.
 */
export interface ListsSettings {
  /** Hero spotlight size (most-covered multi-source stories). */
  heroCount: number;
  /** Main feed size (the rest, newest-active first). */
  feedCount: number;
  /** "Top rated" games rail size. */
  topRatedCount: number;
  /** "Games in focus" (biggest score↔score disconnect) rail size. */
  focusCount: number;
  /** Topic slugs pinned to the FRONT of the hero (manual override). */
  pinnedTopicSlugs: string[];
  /** Game slugs pinned to the FRONT of Top Rated (manual override). */
  pinnedGameSlugs: string[];
  /** Auto-surface games with an ACTIVE promotion at the front of Top Rated. */
  pinPromotedGames: boolean;
  /** Upcoming enrichment: how many days back counts as "New" (recently released). */
  newWindowDays: number;
}

export const LISTS_SETTINGS_KEY = 'lists';

export const LISTS_DEFAULTS: ListsSettings = {
  heroCount: 8,
  feedCount: 18,
  topRatedCount: 6,
  focusCount: 6,
  pinnedTopicSlugs: [],
  pinnedGameSlugs: [],
  pinPromotedGames: true,
  newWindowDays: 30,
};

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

/** Coerce a stored value into a clean, deduped slug list (defensive — untrusted JSON). */
function coerceSlugs(v: unknown, max = 50): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const s = item.trim().toLowerCase();
    if (s && /^[a-z0-9-]+$/.test(s) && !out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function coerce(raw: unknown): ListsSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    heroCount: clampInt(o.heroCount, 1, 24, LISTS_DEFAULTS.heroCount),
    feedCount: clampInt(o.feedCount, 1, 60, LISTS_DEFAULTS.feedCount),
    topRatedCount: clampInt(o.topRatedCount, 1, 24, LISTS_DEFAULTS.topRatedCount),
    focusCount: clampInt(o.focusCount, 1, 24, LISTS_DEFAULTS.focusCount),
    pinnedTopicSlugs: coerceSlugs(o.pinnedTopicSlugs),
    pinnedGameSlugs: coerceSlugs(o.pinnedGameSlugs),
    pinPromotedGames:
      typeof o.pinPromotedGames === 'boolean'
        ? o.pinPromotedGames
        : LISTS_DEFAULTS.pinPromotedGames,
    newWindowDays: clampInt(o.newWindowDays, 1, 365, LISTS_DEFAULTS.newWindowDays),
  };
}

export async function listsSettings(): Promise<ListsSettings> {
  try {
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, LISTS_SETTINGS_KEY))
      .limit(1);
    return coerce(row?.value);
  } catch {
    return { ...LISTS_DEFAULTS };
  }
}

export interface ListsSettingsPatch {
  heroCount?: number;
  feedCount?: number;
  topRatedCount?: number;
  focusCount?: number;
  pinnedTopicSlugs?: string[];
  pinnedGameSlugs?: string[];
  pinPromotedGames?: boolean;
  newWindowDays?: number;
}

/** Patch the list config (only provided fields change) and audit the old→new diff. */
export async function setListsSettings(
  patch: ListsSettingsPatch,
  actor: AuditActor,
): Promise<ListsSettings> {
  const current = await listsSettings();
  const next: ListsSettings = {
    heroCount: patch.heroCount ?? current.heroCount,
    feedCount: patch.feedCount ?? current.feedCount,
    topRatedCount: patch.topRatedCount ?? current.topRatedCount,
    focusCount: patch.focusCount ?? current.focusCount,
    pinnedTopicSlugs: patch.pinnedTopicSlugs
      ? coerceSlugs(patch.pinnedTopicSlugs)
      : current.pinnedTopicSlugs,
    pinnedGameSlugs: patch.pinnedGameSlugs
      ? coerceSlugs(patch.pinnedGameSlugs)
      : current.pinnedGameSlugs,
    pinPromotedGames: patch.pinPromotedGames ?? current.pinPromotedGames,
    newWindowDays: patch.newWindowDays ?? current.newWindowDays,
  };
  const value = next as unknown as Record<string, unknown>;
  await db
    .insert(appSettings)
    .values({ key: LISTS_SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  await writeAudit({
    action: 'update',
    entityType: 'app-settings',
    entityId: LISTS_SETTINGS_KEY,
    changes: {
      heroCount: { from: current.heroCount, to: next.heroCount },
      feedCount: { from: current.feedCount, to: next.feedCount },
      topRatedCount: { from: current.topRatedCount, to: next.topRatedCount },
      focusCount: { from: current.focusCount, to: next.focusCount },
      pinnedTopicSlugs: { from: current.pinnedTopicSlugs, to: next.pinnedTopicSlugs },
      pinnedGameSlugs: { from: current.pinnedGameSlugs, to: next.pinnedGameSlugs },
      pinPromotedGames: { from: current.pinPromotedGames, to: next.pinPromotedGames },
      newWindowDays: { from: current.newWindowDays, to: next.newWindowDays },
    },
    summary: `updated homepage lists (hero ${next.heroCount}, feed ${next.feedCount}, top ${next.topRatedCount}, focus ${next.focusCount}, ${next.pinnedGameSlugs.length} pinned game(s), promoted-pin ${next.pinPromotedGames ? 'on' : 'off'}, New window ${next.newWindowDays}d)`,
    actor,
  });
  return next;
}

/**
 * Stable "pinned first" reorder: the items whose key is in `pinSlugs` float to
 * the front IN THE ORDER THE ADMIN LISTED THEM; everything else keeps its
 * automatic order. A pin that matches nothing is silently ignored (a pinned game
 * with no rating summary simply can't appear in a ratings rail — stays honest).
 */
export function applyPins<T>(items: T[], keyOf: (item: T) => string, pinSlugs: string[]): T[] {
  if (pinSlugs.length === 0) return items;
  const rank = new Map(pinSlugs.map((s, i) => [s, i]));
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const it of items) (rank.has(keyOf(it)) ? pinned : rest).push(it);
  pinned.sort((a, b) => (rank.get(keyOf(a)) ?? 0) - (rank.get(keyOf(b)) ?? 0));
  return [...pinned, ...rest];
}
