import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { appSettings } from '../db/schema';

/**
 * Per-section rank gating for the admin surface (SPEC I6, Slice 3, decision 5:
 * "moderator 30 < admin 40 < owner 50"). The unified Control Panel and
 * field-level RBAC granularity remain I8 — here we gate each admin SECTION by a
 * minimum role rank, centralized in ONE reviewable map and overridable from
 * `app_settings` (the "everything configurable from admin" golden rule; nothing
 * hardcoded at a call site).
 *
 * A section = the FIRST path segment under `/admin/api/` (`games`, `users`,
 * `clustering`, `_audit`, …). The default is ADMIN (40): anything unclassified
 * needs an admin, so a new route is locked-down by default, never wide open.
 * The service token (`x-admin-token`) bypasses this entirely — automation is a
 * trusted credential and `verify:i1…b2` depend on it.
 */
export const RANK = { registered: 10, writer: 20, moderator: 30, admin: 40, owner: 50 } as const;

/** Unclassified sections require an admin. Fail toward MORE restriction. */
export const DEFAULT_SECTION_RANK = RANK.admin;

/**
 * The locked defaults. Identity/authority tables sit at OWNER (editing `roles`
 * redefines the rank ladder itself; editing `users` could re-assign a role —
 * both are privilege-escalation surfaces, so owner-only until I8 adds
 * field-level control). Day-to-day content moderation sits at MODERATOR.
 * Everything else (catalog, ratings, sources, awards, config lists) is ADMIN.
 */
export const SECTION_RANK_DEFAULTS: Readonly<Record<string, number>> = {
  // owner-only — privilege & identity
  users: RANK.owner,
  roles: RANK.owner,
  // moderator — content moderation + the panel bootstrap read
  topics: RANK.moderator,
  articles: RANK.moderator,
  relations: RANK.moderator,
  clustering: RANK.moderator,
  comments: RANK.moderator, // soft-remove / restore reported comments (Slice 4)
  'game-flag-reports': RANK.moderator,
  _meta: RANK.moderator,
  // NOTE: `bias` is deliberately NOT here — bias weights tune the engine behind
  // every public number on the site (system tuning, not day-to-day content
  // moderation), so it falls through to ADMIN (40), same as ratings/catalog.
  // (everything else falls through to DEFAULT_SECTION_RANK = admin)
};

export const RBAC_SETTINGS_KEY = 'rbac';

/** First path segment under /admin/api/ — the section key. */
export function sectionOf(url: string): string {
  const path = (url.split('?')[0] ?? '').replace(/^\/admin\/api\/?/, '').replace(/^\/+/, '');
  return path.split('/')[0] ?? '';
}

function clampRank(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= RANK.owner ? v : null;
}

/**
 * The minimum rank required for a given admin URL. Reads any `app_settings.rbac`
 * override ({ minRanks: { <section>: rank } }, clamped 0–50) layered over the
 * locked defaults. Only ever called on the STAFF-session path (the service
 * token short-circuits before this), so it adds no cost to automation.
 */
export async function requiredRankFor(url: string): Promise<number> {
  const section = sectionOf(url);
  let override: number | null = null;
  try {
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, RBAC_SETTINGS_KEY))
      .limit(1);
    const raw = (row?.value ?? {}) as { minRanks?: Record<string, unknown> };
    if (raw.minRanks && section in raw.minRanks) override = clampRank(raw.minRanks[section]);
  } catch {
    override = null; // a settings blip must not silently OPEN a section
  }
  return override ?? SECTION_RANK_DEFAULTS[section] ?? DEFAULT_SECTION_RANK;
}
