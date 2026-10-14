import {
  buildSiteCopy,
  COPY_DEFAULTS,
  type Block,
  type Inline,
  type SiteCopy,
} from '@gameskeep/shared/copy';
import { RULES_DEFAULTS } from '@gameskeep/shared/constants';

export type { Block, Inline } from '@gameskeep/shared/copy';

/**
 * The public copy + layout knobs (Phase P S3b) — brand, every registry text
 * (placeholders filled), the parsed documents, and the Rules & limits values the
 * frontend applies (hero rotation, latest count, excerpt lengths, quality
 * filter). Read once per request (React cache) from the backend's pre-built
 * `/public/site`; if the API is unreachable the registry DEFAULTS render, so a
 * page never shows a blank brand or label.
 */
export interface PublicSite extends SiteCopy {
  layout: { heroRotateMinutes: number; heroSecondaryCount: number; latestInitial: number };
  display: { qualityFilterMin: number; excerpt: Record<string, number> };
}

const DEFAULT_COPY: SiteCopy = buildSiteCopy(COPY_DEFAULTS);

export function fallbackSite(): PublicSite {
  return {
    ...DEFAULT_COPY,
    layout: {
      heroRotateMinutes: RULES_DEFAULTS.homepage.heroRotateMinutes,
      heroSecondaryCount: RULES_DEFAULTS.homepage.heroSecondaryCount,
      latestInitial: RULES_DEFAULTS.homepage.latestInitial,
    },
    display: {
      qualityFilterMin: RULES_DEFAULTS.display.qualityFilterMin,
      excerpt: { ...RULES_DEFAULTS.display.excerpt },
    },
  };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Accept the payload only when its shape is sound; fill any gap from the defaults. */
export function coerceSite(raw: unknown): PublicSite | null {
  if (!isObj(raw) || typeof raw.brand !== 'string' || !raw.brand.trim()) return null;
  if (!isObj(raw.text) || !isObj(raw.docs) || !isObj(raw.rich)) return null;
  const fb = fallbackSite();
  const num = (v: unknown, d: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : d;
  const layout = isObj(raw.layout) ? raw.layout : {};
  const display = isObj(raw.display) ? raw.display : {};
  const excerpt = isObj(display.excerpt) ? display.excerpt : {};
  const str = (o: unknown, k: string, d: string): string =>
    isObj(o) && typeof o[k] === 'string' ? (o[k] as string) : d;
  return {
    brand: raw.brand,
    tagline: typeof raw.tagline === 'string' ? raw.tagline : fb.tagline,
    domain: typeof raw.domain === 'string' ? raw.domain : fb.domain,
    emails: {
      contact: str(raw.emails, 'contact', fb.emails.contact),
      privacy: str(raw.emails, 'privacy', fb.emails.privacy),
      promote: str(raw.emails, 'promote', fb.emails.promote),
    },
    mailto: {
      contact: str(raw.mailto, 'contact', fb.mailto.contact),
      pitch: str(raw.mailto, 'pitch', fb.mailto.pitch),
      promote: str(raw.mailto, 'promote', fb.mailto.promote),
    },
    text: { ...fb.text, ...(raw.text as Record<string, string>) },
    rich: { ...fb.rich, ...(raw.rich as Record<string, Inline[]>) },
    docs: { ...fb.docs, ...(raw.docs as Record<string, Block[]>) },
    layout: {
      heroRotateMinutes: num(layout.heroRotateMinutes, fb.layout.heroRotateMinutes),
      heroSecondaryCount: num(layout.heroSecondaryCount, fb.layout.heroSecondaryCount),
      latestInitial: num(layout.latestInitial, fb.layout.latestInitial),
    },
    display: {
      qualityFilterMin: num(display.qualityFilterMin, fb.display.qualityFilterMin),
      excerpt: Object.fromEntries(
        Object.entries(fb.display.excerpt).map(([k, d]) => [k, num(excerpt[k], d)]),
      ),
    },
  };
}

/** A registry text by key (placeholders already filled). */
export function siteText(site: Pick<PublicSite, 'text'>, key: string): string {
  return site.text[key] ?? DEFAULT_COPY.text[key] ?? '';
}

/** A document by key. */
export function siteDoc(site: Pick<PublicSite, 'docs'>, key: string): Block[] {
  return site.docs[key] ?? DEFAULT_COPY.docs[key] ?? [];
}

/** Inline-formatted text by key. */
export function siteRich(site: Pick<PublicSite, 'rich'>, key: string): Inline[] {
  return site.rich[key] ?? DEFAULT_COPY.rich[key] ?? [];
}

/** An excerpt length rule by surface (Rules & limits → excerpt lengths). */
export function excerptLen(site: Pick<PublicSite, 'display'>, surface: string): number {
  const v = site.display.excerpt[surface];
  return typeof v === 'number' && v > 0
    ? v
    : ((RULES_DEFAULTS.display.excerpt as Record<string, number>)[surface] ?? 200);
}

// ── the slim client payload (no documents) ───────────────────────────────────
export interface ClientSite {
  brand: string;
  domain: string;
  emails: PublicSite['emails'];
  mailto: PublicSite['mailto'];
  text: Record<string, string>;
  rich: Record<string, Inline[]>;
  layout: PublicSite['layout'];
  display: PublicSite['display'];
}

/** Text keys client components read (labels, empty states, newsletter block). */
const CLIENT_TEXT_PREFIXES = ['brand.name', 'label.', 'empty.', 'home.newsletter.', 'paid.'];

export function toClientSite(site: PublicSite): ClientSite {
  return {
    brand: site.brand,
    domain: site.domain,
    emails: site.emails,
    mailto: site.mailto,
    text: Object.fromEntries(
      Object.entries(site.text).filter(([k]) => CLIENT_TEXT_PREFIXES.some((p) => k.startsWith(p))),
    ),
    rich: Object.fromEntries(Object.entries(site.rich).filter(([k]) => k.startsWith('consent.'))),
    layout: site.layout,
    display: site.display,
  };
}
