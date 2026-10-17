import { eq } from 'drizzle-orm';
import { RULE_BOUNDS, RULES_DEFAULTS, type RulesSettings } from '@gameskeep/shared/constants';
import { db } from '../db/client';
import { appSettings } from '../db/schema';
import { writeAudit, type AuditActor } from '../admin/audit';

/**
 * Product rules (Phase P S3b): every behaviour that used to be a constant in
 * code, as ONE admin setting (app_settings `rules`; Control Panel → Rules &
 * limits). Defaults are exactly the previous behaviour. Read paths get a
 * clamped, complete object (a missing or malformed leaf falls back to its
 * default); writes are validated leaf by leaf and audited old → new per leaf.
 * A short in-process cache keeps hot paths (homepage, catalog) off the DB.
 */
export const RULES_KEY = 'rules';
export const BRIEFING_OVERRIDE_KEY = 'briefing-override';

export class RulesError extends Error {}

type Leaf = boolean | number | number[];
type Tree = { [k: string]: Leaf | Tree };

const isTree = (v: unknown): v is Tree => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

function coerceLeaf(path: string, def: Leaf, raw: unknown): Leaf {
  if (typeof def === 'boolean') return typeof raw === 'boolean' ? raw : def;
  if (Array.isArray(def)) {
    if (!Array.isArray(raw)) return [...def];
    return [...new Set(raw.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= 50))]
      .sort((a, b) => a - b)
      .slice(0, 10);
  }
  const [min, max] = RULE_BOUNDS[path] ?? [0, Number.MAX_SAFE_INTEGER];
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= min && raw <= max ? raw : def;
}

function coerceTree(def: Tree, raw: unknown, prefix: string): Tree {
  const r = isTree(raw) ? raw : {};
  const out: Tree = {};
  for (const [k, d] of Object.entries(def)) {
    const path = prefix ? `${prefix}.${k}` : k;
    out[k] = isTree(d) ? coerceTree(d, r[k], path) : coerceLeaf(path, d as Leaf, r[k]);
  }
  return out;
}

export function coerceRules(raw: unknown): RulesSettings {
  return coerceTree(RULES_DEFAULTS as unknown as Tree, raw, '') as unknown as RulesSettings;
}

let cache: { at: number; value: RulesSettings } | null = null;
const TTL_MS = 10_000;

/**
 * The current rules. `fresh` skips the in-process cache — background jobs that a
 * rules change just enqueued (the homepage compute runs in the WORKER process,
 * whose cache the API write never touched) must see the new values.
 */
export async function rulesSettings(opts: { fresh?: boolean } = {}): Promise<RulesSettings> {
  if (!opts.fresh && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, RULES_KEY))
      .limit(1);
    const value = coerceRules(row?.value);
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return coerceRules(undefined);
  }
}

/**
 * The last rules read in this process (defaults before the first read) — for the
 * few SYNCHRONOUS shaping helpers. Every public entry point awaits rulesSettings()
 * first, so this is at most one TTL old.
 */
export function rulesSnapshot(): RulesSettings {
  return cache?.value ?? coerceRules(undefined);
}

/** Validate a deep-partial patch leaf by leaf (unknown keys, wrong types, out of range → 400). */
function validatePatch(def: Tree, patch: unknown, prefix: string, errors: string[]): void {
  if (!isTree(patch)) {
    errors.push(`${prefix || 'rules'}: expected an object`);
    return;
  }
  for (const [k, v] of Object.entries(patch)) {
    const path = prefix ? `${prefix}.${k}` : k;
    // Own keys only: an inherited name ("constructor", "toString") is not a rule.
    const d = Object.prototype.hasOwnProperty.call(def, k) ? def[k] : undefined;
    if (d === undefined) {
      errors.push(`${path}: unknown rule`);
      continue;
    }
    if (isTree(d)) {
      validatePatch(d, v, path, errors);
      continue;
    }
    if (typeof d === 'boolean') {
      if (typeof v !== 'boolean') errors.push(`${path}: expected true/false`);
      continue;
    }
    if (Array.isArray(d)) {
      if (
        !Array.isArray(v) ||
        v.some((n) => !Number.isInteger(n) || n < 1 || n > 50) ||
        v.length > 10
      ) {
        errors.push(`${path}: expected up to 10 whole numbers from 1 to 50`);
      }
      continue;
    }
    const [min, max] = RULE_BOUNDS[path] ?? [0, Number.MAX_SAFE_INTEGER];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      errors.push(`${path}: expected a whole number from ${min} to ${max}`);
    }
  }
}

function merge(base: Tree, patch: Tree): Tree {
  const out: Tree = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isTree(v) && isTree(base[k]) ? merge(base[k] as Tree, v) : (v as Leaf);
  }
  return out;
}

function diff(
  a: Tree,
  b: Tree,
  prefix: string,
  out: Record<string, { from: unknown; to: unknown }>,
): void {
  for (const k of Object.keys(b)) {
    const path = prefix ? `${prefix}.${k}` : k;
    const x = a[k];
    const y = b[k];
    if (isTree(x) && isTree(y)) diff(x, y, path, out);
    else if (JSON.stringify(x) !== JSON.stringify(y)) out[path] = { from: x, to: y };
  }
}

/** Every problem with a rules patch (empty = valid). Exported for the unit tests. */
export function rulesPatchErrors(patch: unknown): string[] {
  const errors: string[] = [];
  validatePatch(RULES_DEFAULTS as unknown as Tree, patch, '', errors);
  return errors;
}

/** Rules that only make sense together (pure; unit-tested). */
export function crossRuleErrors(r: RulesSettings): string[] {
  const out: string[] = [];
  if (r.communityNote.minSentences > r.communityNote.maxSentences) {
    out.push('communityNote: the minimum sentences cannot exceed the maximum');
  }
  return out;
}

export async function setRulesSettings(
  patch: unknown,
  actor: AuditActor,
): Promise<{ settings: RulesSettings; changed: string[] }> {
  const errors: string[] = [];
  validatePatch(RULES_DEFAULTS as unknown as Tree, patch, '', errors);
  if (errors.length) throw new RulesError(errors.join('; '));
  cache = null;
  const current = await rulesSettings();
  const next = coerceRules(merge(current as unknown as Tree, patch as Tree));
  const cross = crossRuleErrors(next);
  if (cross.length) throw new RulesError(cross.join('; '));
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  diff(current as unknown as Tree, next as unknown as Tree, '', changes);
  if (Object.keys(changes).length) {
    const value = next as unknown as Record<string, unknown>;
    await db
      .insert(appSettings)
      .values({ key: RULES_KEY, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
    await writeAudit({
      action: 'update',
      entityType: 'app-settings',
      entityId: RULES_KEY,
      changes,
      summary: `rules: ${Object.keys(changes).join(', ')}`,
      actor,
    });
  }
  cache = { at: Date.now(), value: next };
  return { settings: next, changed: Object.keys(changes) };
}

// ── the briefing line override (per UTC day) ─────────────────────────────────
export interface BriefingOverride {
  /** The UTC day it applies to (YYYY-MM-DD) — it lapses by itself the next day. */
  date: string | null;
  /** Replaces the counts line that day (null = keep the counts). */
  text: string | null;
  /** Hide the briefing that day. */
  hidden: boolean;
}
const NO_OVERRIDE: BriefingOverride = { date: null, text: null, hidden: false };

export async function briefingOverride(): Promise<BriefingOverride> {
  try {
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, BRIEFING_OVERRIDE_KEY))
      .limit(1);
    const v = (row?.value ?? {}) as Record<string, unknown>;
    return {
      date: typeof v.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.date) ? v.date : null,
      text: typeof v.text === 'string' && v.text.trim() ? v.text.trim().slice(0, 300) : null,
      hidden: v.hidden === true,
    };
  } catch {
    return { ...NO_OVERRIDE };
  }
}

/** Today's override, if one is set for today (UTC); otherwise null. */
export async function briefingOverrideToday(now = new Date()): Promise<BriefingOverride | null> {
  const o = await briefingOverride();
  return o.date === now.toISOString().slice(0, 10) && (o.hidden || o.text) ? o : null;
}

export async function setBriefingOverride(
  input: unknown,
  actor: AuditActor,
): Promise<BriefingOverride> {
  const v = (isTree(input) ? input : {}) as Record<string, unknown>;
  const date = v.date === null ? null : typeof v.date === 'string' ? v.date : undefined;
  if (date !== null && (date === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
    throw new RulesError('date: expected YYYY-MM-DD (or null to clear)');
  }
  if (
    v.text !== undefined &&
    v.text !== null &&
    (typeof v.text !== 'string' || v.text.length > 300)
  ) {
    throw new RulesError('text: up to 300 characters (or null)');
  }
  if (v.hidden !== undefined && typeof v.hidden !== 'boolean') {
    throw new RulesError('hidden: expected true/false');
  }
  const before = await briefingOverride();
  const next: BriefingOverride =
    date === null
      ? { ...NO_OVERRIDE }
      : {
          date,
          text: typeof v.text === 'string' && v.text.trim() ? v.text.trim() : null,
          hidden: v.hidden === true,
        };
  await db
    .insert(appSettings)
    .values({ key: BRIEFING_OVERRIDE_KEY, value: next as unknown as Record<string, unknown> })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: next as unknown as Record<string, unknown>, updatedAt: new Date() },
    });
  await writeAudit({
    action: 'update',
    entityType: 'app-settings',
    entityId: BRIEFING_OVERRIDE_KEY,
    changes: { from: before, to: next },
    summary: next.date ? `briefing override for ${next.date}` : 'briefing override cleared',
    actor,
  });
  return next;
}
