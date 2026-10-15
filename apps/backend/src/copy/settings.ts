import { eq } from 'drizzle-orm';
import {
  buildSiteCopy,
  COPY_DEFAULTS,
  COPY_DEFS,
  copyDef,
  copyValueProblems,
  copyVars,
  type SiteCopy,
} from '@gameskeep/shared/copy';
import { db } from '../db/client';
import { appSettings } from '../db/schema';
import { writeAudit, type AuditActor } from '../admin/audit';
import { rulesSettings } from '../rules/settings';

/**
 * The copy registry store (Phase P S3b) — app_settings `copy` holds ONLY the
 * overrides ({ values: { key: text } }); every other key reads its default from
 * the shared registry, so an empty store renders the site exactly as before.
 * Locked keys are never stored and always read their default. A short
 * in-process cache keeps every page render off the DB.
 */
export const COPY_KEY = 'copy';

export class CopyError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 = 400,
  ) {
    super(message);
  }
}

export interface CopyState {
  /** The stored overrides (what the admin changed). */
  stored: Record<string, string>;
  /** Every key's effective RAW value (placeholders not yet filled). */
  values: Record<string, string>;
}

/** Keep only known, unlocked string overrides (anything else is ignored on read). */
export function coerceStored(raw: unknown): Record<string, string> {
  const v =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).values
      : undefined;
  const out: Record<string, string> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const def = copyDef(k);
    if (!def || def.locked || typeof val !== 'string') continue;
    if (val.length > def.max) continue;
    if (def.required && !val.trim()) continue;
    out[k] = val;
  }
  return out;
}

export function effectiveValues(stored: Record<string, string>): Record<string, string> {
  const values: Record<string, string> = { ...COPY_DEFAULTS };
  for (const [k, v] of Object.entries(stored)) values[k] = v;
  return values;
}

let cache: { at: number; state: CopyState } | null = null;
const TTL_MS = 10_000;

export async function copyState(): Promise<CopyState> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.state;
  try {
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, COPY_KEY))
      .limit(1);
    const stored = coerceStored(row?.value);
    const state = { stored, values: effectiveValues(stored) };
    cache = { at: Date.now(), state };
    return state;
  } catch {
    return { stored: {}, values: effectiveValues({}) };
  }
}

/** The last copy read in this process (defaults before the first) — for sync helpers. */
export function copySnapshot(): CopyState {
  return cache?.state ?? { stored: {}, values: effectiveValues({}) };
}

/** The public brand name (sync; at most one cache TTL old). */
export function brandName(): string {
  return copySnapshot().values['brand.name'] ?? 'GamesKeep';
}

// ── the public payload ───────────────────────────────────────────────────────
export interface PublicSite extends SiteCopy {
  layout: {
    heroRotateMinutes: number;
    heroSecondaryCount: number;
    latestInitial: number;
    /** Phase P S4 */
    searchMinChars: number;
    listsInNav: boolean;
  };
  display: {
    qualityFilterMin: number;
    excerpt: Record<string, number>;
  };
}

export function buildPublicSite(
  values: Record<string, string>,
  rules: Awaited<ReturnType<typeof rulesSettings>>,
  now = new Date(),
): PublicSite {
  return {
    ...buildSiteCopy(values, now),
    layout: {
      heroRotateMinutes: rules.homepage.heroRotateMinutes,
      heroSecondaryCount: rules.homepage.heroSecondaryCount,
      latestInitial: rules.homepage.latestInitial,
      searchMinChars: rules.search.minChars,
      listsInNav: rules.editorialLists.showInNav,
    },
    display: {
      qualityFilterMin: rules.display.qualityFilterMin,
      excerpt: { ...rules.display.excerpt },
    },
  };
}

let siteCache: { at: number; site: PublicSite } | null = null;

export async function publicSite(): Promise<PublicSite> {
  if (siteCache && Date.now() - siteCache.at < TTL_MS) return siteCache.site;
  const [state, rules] = await Promise.all([copyState(), rulesSettings()]);
  const site = buildPublicSite(state.values, rules);
  siteCache = { at: Date.now(), site };
  return site;
}

// ── writes ───────────────────────────────────────────────────────────────────
/** Single-line kinds are trimmed; documents keep their lines (trailing spaces trimmed). */
function normalize(kind: string, v: string): string {
  if (kind === 'doc' || kind === 'longtext') {
    return v
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((l) => l.replace(/[ \t]+$/, ''))
      .join('\n')
      .trim();
  }
  return v.trim();
}

/**
 * Apply a patch of { key: text | null } (null = back to the default). Unknown
 * keys, locked keys, invalid values → 400; identity keys without owner rank →
 * 403. The whole patch is validated against the values it would produce (so a
 * brand change and a document using it are checked together), then stored as
 * overrides only, audited old → new per key.
 */
export async function setCopy(
  patch: unknown,
  actor: AuditActor,
  opts: { isOwner: boolean },
): Promise<{ state: CopyState; changed: string[] }> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new CopyError('Expected { values: { key: text | null } }');
  }
  const entries = Object.entries(patch as Record<string, unknown>);
  if (entries.length === 0) throw new CopyError('Nothing to change');
  if (entries.length > COPY_DEFS.length) throw new CopyError('Too many keys');

  cache = null;
  const current = await copyState();
  const nextStored: Record<string, string> = { ...current.stored };
  const errors: string[] = [];
  for (const [key, raw] of entries) {
    const def = copyDef(key);
    if (!def) {
      errors.push(`${key}: unknown text`);
      continue;
    }
    if (def.locked) {
      errors.push(`${key}: locked (legally required) — it cannot be edited here`);
      continue;
    }
    if (def.ownerOnly && !opts.isOwner) {
      throw new CopyError(`${key}: only the owner can change the brand and contact details`, 403);
    }
    if (raw === null) {
      delete nextStored[key];
      continue;
    }
    if (typeof raw !== 'string') {
      errors.push(`${key}: expected text (or null for the default)`);
      continue;
    }
    const v = normalize(def.kind, raw);
    if (v === def.default) delete nextStored[key];
    else nextStored[key] = v;
  }
  if (errors.length) throw new CopyError(errors.join('; '));

  const nextValues = effectiveValues(nextStored);
  const vars = copyVars(nextValues);
  for (const [key] of entries) {
    const def = copyDef(key);
    if (!def) continue;
    const problems = copyValueProblems(def, nextValues[key] ?? '', vars);
    if (problems.length) errors.push(`${key}: ${problems.join('; ')}`);
  }
  if (errors.length) throw new CopyError(errors.join('; '));

  const changes: Record<string, { from: string; to: string }> = {};
  for (const [key] of entries) {
    const from = current.values[key] ?? '';
    const to = nextValues[key] ?? '';
    if (from !== to) changes[key] = { from, to };
  }
  if (Object.keys(changes).length) {
    const value = { values: nextStored } as Record<string, unknown>;
    await db
      .insert(appSettings)
      .values({ key: COPY_KEY, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
    await writeAudit({
      action: 'update',
      entityType: 'app-settings',
      entityId: COPY_KEY,
      changes,
      summary: `copy: ${Object.keys(changes).join(', ')}`,
      actor,
    });
  }
  const state = { stored: nextStored, values: nextValues };
  cache = { at: Date.now(), state };
  siteCache = null;
  return { state, changed: Object.keys(changes) };
}

/** Drop the derived public payload (a rules change alters its layout knobs). */
export function invalidatePublicSite(): void {
  siteCache = null;
}
