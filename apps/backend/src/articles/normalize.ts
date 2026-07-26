import type { ArticleType } from '@gameskeep/shared/constants';
import { ARTICLE_TYPES } from '@gameskeep/shared/constants';
import type { RawFeedItem } from '../data-source/articles';
import { slugify } from '../lib/slug';

/**
 * Defensive normalizer for raw feed items (SPEC I3 §2; CLAUDE.md anti-bug rule:
 * "never trust external data is well-formed"). RSS feeds — and any scraped
 * source — return partial, oddly-encoded or oversized fields. This turns ANY
 * input into a clean, DB-safe article payload or returns `null` when there isn't
 * even a usable title + guid. It NEVER throws on bad input.
 *
 * It captures the FACTUAL detected signals (affiliate/sponsored/review-copy/
 * paywall/type) only — the bias *scoring* on those signals is I4.
 */
export interface CleanArticle {
  guid: string;
  slug: string;
  sourceSlug: string;
  title: string;
  author?: string;
  url?: string;
  thumbnailUrl?: string;
  excerpt?: string;
  publishDate?: Date;
  articleType: ArticleType;
  isPaywalled: boolean;
  hasAffiliateLinks: boolean;
  isSponsored: boolean;
  basedOnReviewCopy: boolean;
  gameRefs: string[];
  /** The text the embedding is computed from (title + excerpt). */
  embedText: string;
}

const ARTICLE_TYPE_SET = new Set<string>(ARTICLE_TYPES);

function str(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

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

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  // Reject absurd dates (bad feeds emit year 0001 / far future) without throwing.
  const year = d.getUTCFullYear();
  if (year < 1990 || year > 2100) return undefined;
  return d;
}

function gameRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const s = str(item, 300);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= 20) break;
  }
  return out;
}

export function sanitizeFeedItem(
  input: Partial<RawFeedItem> | null | undefined,
): CleanArticle | null {
  if (!input || typeof input !== 'object') return null;
  const title = str(input.title, 300);
  const guid = str(input.guid, 400);
  const sourceSlug = str(input.sourceSlug, 160);
  // No title, no stable id, or no owning source → unusable.
  if (!title || !guid || !sourceSlug) return null;

  const excerpt = str(input.excerpt, 2000);
  const articleTypeRaw = typeof input.articleType === 'string' ? input.articleType : '';
  const articleType: ArticleType = ARTICLE_TYPE_SET.has(articleTypeRaw)
    ? (articleTypeRaw as ArticleType)
    : 'news';

  return {
    guid,
    // Slug is SEO-facing (derived from the title); idempotency keys on guid.
    slug: slugify(title).slice(0, 180) || slugify(guid).slice(0, 180),
    sourceSlug,
    title,
    author: str(input.author, 200),
    url: httpUrl(input.url),
    thumbnailUrl: httpUrl(input.thumbnailUrl),
    excerpt,
    publishDate: parseDate(input.publishedAt),
    articleType,
    isPaywalled: input.isPaywalled === true,
    hasAffiliateLinks: input.hasAffiliateLinks === true,
    isSponsored: input.isSponsored === true,
    basedOnReviewCopy: input.basedOnReviewCopy === true,
    gameRefs: gameRefs(input.gameRefs),
    embedText: excerpt ? `${title}. ${excerpt}` : title,
  };
}
