import { COPY_DEFAULTS } from '@gameskeep/shared/copy';
import { RULES_DEFAULTS } from '@gameskeep/shared/constants';

/**
 * Card & badge labels from the copy registry, plus the excerpt-length rules
 * (Phase P S3b), for the small pure helpers (status chips, signal flags,
 * excerpt clips) that run in both server and client code. The store holds
 * GLOBAL site settings only — the same for every reader — and is refreshed by
 * `getSite()` on the server (every public page awaits it before rendering) and
 * by `SiteProvider` in the browser before anything below it renders. Until
 * then it reads the registry / rules defaults, so a label is never blank.
 */
let current: Readonly<Record<string, string>> = {};
let excerpts: Readonly<Record<string, number>> = {};

export function setSiteLabels(
  text: Readonly<Record<string, string>> | null | undefined,
  excerpt?: Readonly<Record<string, number>> | null,
  opts: { merge?: boolean } = {},
): void {
  // `merge` (SiteProvider: the client SUBSET) never drops the full server set
  // when both renders happen to share this module instance.
  if (text && typeof text === 'object') current = opts.merge ? { ...current, ...text } : text;
  if (excerpt && typeof excerpt === 'object') excerpts = excerpt;
}

/**
 * A registry text by key (e.g. `label.ourPick`), falling back to its default.
 * Server-side the store holds every text; client-side the slim client subset
 * (labels, empty states, the newsletter block).
 */
export function label(key: string): string {
  const v = current[key];
  return typeof v === 'string' && v.trim() ? v : (COPY_DEFAULTS[key] ?? '');
}

/** The public brand name. */
export function brand(): string {
  return label('brand.name');
}

const EXCERPT_DEFAULTS = RULES_DEFAULTS.display.excerpt as Readonly<Record<string, number>>;

/** An excerpt length (Rules & limits → excerpt lengths) for a surface. */
export function excerptRule(surface: keyof typeof RULES_DEFAULTS.display.excerpt): number {
  const v = excerpts[surface];
  return typeof v === 'number' && Number.isFinite(v) && v > 0
    ? v
    : (EXCERPT_DEFAULTS[surface] ?? 200);
}

const GAME_STATUS_KEY: Readonly<Record<string, string>> = {
  announced: 'label.game.announced',
  in_development: 'label.game.inDevelopment',
  early_access: 'label.game.earlyAccess',
  released: 'label.game.released',
  delisted: 'label.game.delisted',
};

/** A game status chip label; an unknown status shows as stored. */
export function gameStatusLabel(status: string): string {
  const k = GAME_STATUS_KEY[status];
  return k ? label(k) : status;
}

/** A disconnect band label (`short` = the compact tile wording for "agree"). */
export function bandLabel(band: string, short = false): string | null {
  if (band === 'agree') return label(short ? 'label.band.agreeShort' : 'label.band.agree');
  if (band === 'mild' || band === 'notable' || band === 'large') return label(`label.band.${band}`);
  return null;
}
