import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { appSettings } from '../db/schema';
import { writeAudit, type AuditActor } from '../admin/audit';

/**
 * The `lists` app_setting (I8 Slice 4 → Upcoming enrichment): today only the
 * "New" (recently released) window, shared by the /upcoming page and the
 * homepage New section. The homepage rail sizes + pins it used to hold moved to
 * the homepage SECTIONS (Phase P S2; carried over once by
 * `ensureHomepageSections`), and `pinPromotedGames` was removed — a paid item is
 * a labeled placement, never an unlabeled pin. Clamp-with-defaults + audit-on-write.
 */
export interface ListsSettings {
  /** Upcoming enrichment: how many days back counts as "New" (recently released). */
  newWindowDays: number;
}

export const LISTS_SETTINGS_KEY = 'lists';

export const LISTS_DEFAULTS: ListsSettings = { newWindowDays: 30 };

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

function coerce(raw: unknown): ListsSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { newWindowDays: clampInt(o.newWindowDays, 1, 365, LISTS_DEFAULTS.newWindowDays) };
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
  newWindowDays?: number;
}

/** Patch the New window and audit the old→new diff. Superseded keys are dropped. */
export async function setListsSettings(
  patch: ListsSettingsPatch,
  actor: AuditActor,
): Promise<ListsSettings> {
  const current = await listsSettings();
  const next: ListsSettings = { newWindowDays: patch.newWindowDays ?? current.newWindowDays };
  const value = next as unknown as Record<string, unknown>;
  await db
    .insert(appSettings)
    .values({ key: LISTS_SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  await writeAudit({
    action: 'update',
    entityType: 'app-settings',
    entityId: LISTS_SETTINGS_KEY,
    changes: { newWindowDays: { from: current.newWindowDays, to: next.newWindowDays } },
    summary: `updated lists (New window ${next.newWindowDays}d)`,
    actor,
  });
  return next;
}
