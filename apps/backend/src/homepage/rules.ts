import {
  HOMEPAGE_MAX_ITEMS,
  HOMEPAGE_RULE_DIMENSIONS,
  type HomepageItemType,
  type HomepageRuleDimension,
  type HomepageSectionMode,
} from '@gameskeep/shared/constants';
import type { TrendingWeights } from './settings';

/**
 * Pure homepage rules (Phase P S2) — no DB, unit-tested. The snapshots job feeds
 * them; nothing here runs on a request.
 */

// ── Δ ──────────────────────────────────────────────────────────────────────────
export type Delta = { kind: 'pct'; value: number } | { kind: 'new' } | { kind: 'none' };

const pct = (now: number, prev: number): Delta => ({
  kind: 'pct',
  value: Math.round(((now - prev) / prev) * 100),
});

/**
 * Trending Δ: this window's score vs the previous window of equal length. A
 * story with an EMPTY previous window is "New" (owner rule) — never "—", never a
 * made-up %. Nothing in either window → "—".
 */
export function trendingDelta(now: number, prev: number): Delta {
  const n = Number.isFinite(now) && now > 0 ? now : 0;
  const p = Number.isFinite(prev) && prev > 0 ? prev : 0;
  if (n === 0 && p === 0) return { kind: 'none' };
  if (p === 0) return { kind: 'new' };
  return pct(n, p);
}

/**
 * By-players Δ: average concurrent players now vs the previous window. Fewer
 * than `minPoints` samples in EITHER window (or a zero baseline) → "—" — never
 * 0% or a guess.
 */
export function playersDelta(
  nowSamples: number[],
  prevSamples: number[],
  minPoints: number,
): Delta {
  const clean = (xs: number[]): number[] => xs.filter((n) => Number.isFinite(n) && n >= 0);
  const a = clean(nowSamples);
  const b = clean(prevSamples);
  const need = Math.max(1, Math.floor(minPoints));
  if (a.length < need || b.length < need) return { kind: 'none' };
  const avgA = a.reduce((s, n) => s + n, 0) / a.length;
  const avgB = b.reduce((s, n) => s + n, 0) / b.length;
  if (!(avgB > 0)) return { kind: 'none' };
  return pct(avgA, avgB);
}

/** Average of the clean samples (null when none). */
export function average(samples: number[]): number | null {
  const a = samples.filter((n) => Number.isFinite(n) && n >= 0);
  return a.length ? a.reduce((s, n) => s + n, 0) / a.length : null;
}

// ── Trending score ─────────────────────────────────────────────────────────────
export interface EngagementByUser {
  /** The account's 0→1.0 credibility (the same curve as community ratings). */
  credibility: number;
  /** How many units of this signal the account produced in the window. */
  count: number;
}

/**
 * Credibility-weighted, per-user-capped engagement mass: Σ credibility × min(count,
 * cap). A ring of fresh, unverified accounts (credibility ≈ 0) adds ≈ 0; one
 * prolific account adds at most `cap` × its credibility.
 */
export function cappedCredibleMass(users: EngagementByUser[], cap: number): number {
  const c = Math.max(1, Math.floor(cap));
  let mass = 0;
  for (const u of users) {
    const cred = Number.isFinite(u.credibility) ? Math.min(1, Math.max(0, u.credibility)) : 0;
    const n = Number.isFinite(u.count) ? Math.max(0, Math.floor(u.count)) : 0;
    mass += cred * Math.min(n, c);
  }
  return Math.round(mass * 1000) / 1000;
}

export interface TrendingInputs {
  articles: number;
  sources: number;
  /** cappedCredibleMass of comments in the window. */
  comments: number;
  /** cappedCredibleMass of follows in the window. */
  follows: number;
}

/**
 * Trending score = coverage (articles + outlets in the window) + engagement
 * (credibility-weighted comments + follows). Engagement AMPLIFIES coverage, it
 * never replaces it: its part is capped at `maxEngagementShare` × the coverage
 * part — a story with no coverage in the window gains nothing from engagement,
 * so a ring of accounts cannot push a quiet story into Trending.
 */
export function trendingScore(
  i: TrendingInputs,
  w: TrendingWeights,
  maxEngagementShare = 1,
): number {
  const v = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);
  const coverage = w.articles * v(i.articles) + w.sources * v(i.sources);
  const engagement = w.comments * v(i.comments) + w.follows * v(i.follows);
  const share =
    Number.isFinite(maxEngagementShare) && maxEngagementShare > 0 ? maxEngagementShare : 0;
  return Math.round((coverage + Math.min(engagement, coverage * share)) * 1000) / 1000;
}

/** Credibility that counts toward Trending: below the floor an account adds nothing. */
export function countedCredibility(credibility: number, floor: number): number {
  const c = Number.isFinite(credibility) ? Math.min(1, Math.max(0, credibility)) : 0;
  return c >= floor ? c : 0;
}

// ── feed rules ─────────────────────────────────────────────────────────────────
export type RuleLists = Partial<Record<HomepageRuleDimension, string[]>>;
export interface SectionRules {
  include: RuleLists;
  exclude: RuleLists;
}

/** Which rule dimensions a section's items can be filtered on. */
export function ruleDimensionsFor(items: HomepageItemType): HomepageRuleDimension[] {
  if (items === 'topic') return ['categories', 'tags', 'genres', 'sources'];
  if (items === 'game' || items === 'mixed') return ['tags', 'genres'];
  return [];
}

function cleanList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const s = item.trim().toLowerCase();
    if (s && s.length <= 80 && !out.includes(s)) out.push(s);
    if (out.length >= 50) break;
  }
  return out;
}

/** Stored rules → clean rules (defensive: untrusted JSON, unknown dims dropped). */
export function coerceRules(raw: unknown): SectionRules {
  const o =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const side = (v: unknown): RuleLists => {
    const s = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    const out: RuleLists = {};
    for (const dim of HOMEPAGE_RULE_DIMENSIONS) {
      const list = cleanList(s[dim]);
      if (list.length) out[dim] = list;
    }
    return out;
  };
  return { include: side(o.include), exclude: side(o.exclude) };
}

/**
 * An item passes when, per dimension: it intersects every non-empty INCLUDE
 * list, and intersects no EXCLUDE list. Attributes are compared lower-cased.
 */
export function matchesRules(attrs: RuleLists, rules: SectionRules): boolean {
  const have = (dim: HomepageRuleDimension): Set<string> =>
    new Set((attrs[dim] ?? []).map((s) => s.toLowerCase()));
  for (const dim of HOMEPAGE_RULE_DIMENSIONS) {
    const inc = rules.include[dim] ?? [];
    if (inc.length && !inc.some((x) => have(dim).has(x))) return false;
    const exc = rules.exclude[dim] ?? [];
    if (exc.length && exc.some((x) => have(dim).has(x))) return false;
  }
  return true;
}

// ── composition: pins + auto + the one Promoted item ───────────────────────────
export interface Composed {
  ref: string;
  pinned: boolean;
  promoted: boolean;
}

/**
 * Lay out a section. MANUAL: pins only (by position). AUTO: the rule order only.
 * PINS + AUTO: every pin holds its explicit position, auto fills the rest. Then
 * the ONE Promoted item (discovery sections only — the caller never passes one
 * for a data section) takes its admin-chosen position; if it was already listed
 * it moves there. Holes close up (a pin past the end of a short list moves up).
 */
export function composeSection(args: {
  mode: HomepageSectionMode;
  itemCount: number;
  pins: { position: number; ref: string }[];
  auto: string[];
  promoted?: { position: number; ref: string } | null;
}): Composed[] {
  const count = Math.min(HOMEPAGE_MAX_ITEMS, Math.max(1, Math.floor(args.itemCount)));
  const pins = [...args.pins]
    .filter((p) => Number.isInteger(p.position) && p.position >= 1 && p.ref)
    .sort((a, b) => a.position - b.position);
  const slots: (Composed | null)[] = Array.from({ length: count }, () => null);
  const used = new Set<string>();

  if (args.mode !== 'auto') {
    for (const p of pins) {
      if (used.has(p.ref)) continue;
      if (args.mode === 'manual') {
        const free = slots.findIndex((s) => s === null);
        if (free === -1) break;
        slots[free] = { ref: p.ref, pinned: true, promoted: false };
      } else if (p.position <= count && slots[p.position - 1] === null) {
        slots[p.position - 1] = { ref: p.ref, pinned: true, promoted: false };
      } else continue;
      used.add(p.ref);
    }
  }
  if (args.mode !== 'manual') {
    let i = 0;
    for (const ref of args.auto) {
      if (used.has(ref)) continue;
      while (i < count && slots[i] !== null) i += 1;
      if (i >= count) break;
      slots[i] = { ref, pinned: false, promoted: false };
      used.add(ref);
    }
  }

  let out = slots.filter((s): s is Composed => s !== null);
  const promo = args.promoted;
  if (promo && promo.ref && Number.isInteger(promo.position) && promo.position >= 1) {
    out = out.filter((s) => s.ref !== promo.ref);
    const at = Math.min(promo.position - 1, out.length);
    out.splice(at, 0, { ref: promo.ref, pinned: false, promoted: true });
    out = out.slice(0, count);
  }
  return out;
}
