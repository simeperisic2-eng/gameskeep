import type { GameStatus } from '@gameskeep/shared/constants';
import { GAME_STATUSES } from '@gameskeep/shared/constants';
import type { NormalizedGame } from '../data-source/games';

/**
 * Defensive sanitizer for provider data (SPEC I2 §3; CLAUDE.md anti-bug rule:
 * "never trust external data is well-formed"). Providers — even the mock one,
 * and especially live IGDB/RAWG — return partial, oddly-typed or oversized
 * fields. This turns ANY input into a clean, DB-safe game payload, or returns
 * `null` when there isn't even a usable name. It NEVER throws on bad input.
 *
 * The output mirrors the I1 `gameCreate` shape (a Game is a Subject
 * specialization: name/slug → subject, the rest → game row).
 */
export interface CleanGame {
  name: string;
  slug?: string;
  summary?: string;
  description?: string;
  status: GameStatus;
  releaseDate?: string;
  developer?: string;
  publisher?: string;
  engine?: string;
  ageRatingSystem?: string;
  ageRatingValue?: string;
  series?: string;
  mode?: string[];
  genres?: string[];
  platforms?: string[];
  tags?: string[];
  screenshots?: string[];
  coverUrl?: string;
  backgroundUrl?: string;
  socialLinks?: Record<string, string>;
  steamAppId?: number;
  hltbMainHours?: number;
  hltbCompletionistHours?: number;
  steamCompletionRate?: number;
  externalRefs?: Record<string, string | number>;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const GAME_STATUS_SET = new Set<string>(GAME_STATUSES);

/** Trim + clamp a value to a string, or undefined if not a usable string. */
function str(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

/** Coerce to a clean string[] (tolerates a single string), deduped + capped. */
function strArray(value: unknown, itemMax = 160, max = 100): string[] | undefined {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? [value] : null;
  if (!raw) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const s = str(item, itemMax);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }
  return out.length > 0 ? out : undefined;
}

/** Keep a value only if it's a well-formed http(s) URL within length. */
function httpUrl(value: unknown, max = 2048): string | undefined {
  const s = str(value, max);
  if (!s) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? s : undefined;
  } catch {
    return undefined;
  }
}

function urlArray(value: unknown, max = 50): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    const u = httpUrl(item);
    if (u) out.push(u);
    if (out.length >= max) break;
  }
  return out.length > 0 ? out : undefined;
}

/** Clamp a finite number into [min, max]; undefined if not a real number. */
function num(value: unknown, min: number, max: number, integer = false): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return undefined;
  const clamped = Math.min(Math.max(n, min), max);
  return integer ? Math.round(clamped) : clamped;
}

/**
 * A finite number that is DROPPED (→ undefined) when out of range, rather than
 * clamped. Used for ids/codes where a clamped value would be misleading (a
 * negative Steam app id must not silently become "1").
 */
function numInRange(value: unknown, min: number, max: number, integer = false): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < min || n > max) return undefined;
  return integer ? Math.round(n) : n;
}

function status(value: unknown): GameStatus {
  return typeof value === 'string' && GAME_STATUS_SET.has(value)
    ? (value as GameStatus)
    : 'announced';
}

function slug(value: unknown): string | undefined {
  const s = str(value, 160);
  if (!s) return undefined;
  return SLUG_RE.test(s) ? s : undefined;
}

function releaseDate(value: unknown): string | undefined {
  const s = str(value, 10);
  if (!s || !ISO_DATE_RE.test(s)) return undefined;
  // Reject impossible dates (e.g. 2020-13-40) without throwing.
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? undefined : s;
}

function socialLinks(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = str(k, 60);
    const url = httpUrl(v);
    if (key && url) out[key] = url;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function externalRefs(value: unknown): Record<string, string | number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = str(k, 40);
    if (!key) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    else {
      const s = str(v, 200);
      if (s) out[key] = s;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Drop undefined keys so the payload is a tidy partial insert. */
function compact<T extends Record<string, unknown>>(obj: T): T {
  for (const key of Object.keys(obj)) {
    if (obj[key] === undefined) delete obj[key];
  }
  return obj;
}

export function sanitizeNormalizedGame(
  input: Partial<NormalizedGame> | null | undefined,
): CleanGame | null {
  if (!input || typeof input !== 'object') return null;
  const name = str((input as { name?: unknown }).name, 300);
  if (!name) return null; // no usable identity → can't make a game

  // Keep the provider id round-trippable: prefer the explicit refs map, and fall
  // back to folding a bare externalId in if the provider didn't supply one.
  let refs = externalRefs(input.externalRefs);
  const externalId = str(input.externalId, 200);
  if (externalId && !(refs && Object.values(refs).map(String).includes(externalId))) {
    refs = { ...(refs ?? {}), external: externalId };
  }

  const clean: CleanGame = compact({
    name,
    slug: slug(input.slug),
    summary: str(input.summary, 600),
    description: str(input.description, 20_000),
    status: status(input.status),
    releaseDate: releaseDate(input.releaseDate),
    developer: str(input.developer, 200),
    publisher: str(input.publisher, 200),
    engine: str(input.engine, 120),
    ageRatingSystem: str(input.ageRatingSystem, 40),
    ageRatingValue: str(input.ageRatingValue, 40),
    series: str(input.series, 200),
    mode: strArray(input.mode),
    genres: strArray(input.genres),
    platforms: strArray(input.platforms),
    tags: strArray(input.tags),
    screenshots: urlArray(input.screenshots),
    coverUrl: httpUrl(input.coverUrl),
    backgroundUrl: httpUrl(input.backgroundUrl),
    socialLinks: socialLinks(input.socialLinks),
    steamAppId: numInRange(input.steamAppId, 1, 2_147_483_647, true),
    hltbMainHours: num(input.hltbMainHours, 0, 100_000),
    hltbCompletionistHours: num(input.hltbCompletionistHours, 0, 100_000),
    steamCompletionRate: num(input.steamCompletionRate, 0, 100),
    externalRefs: refs,
  });
  return clean;
}
