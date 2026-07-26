import type { ArticleType } from '@gameskeep/shared/constants';

/**
 * The ONE normalized raw-feed item every article provider yields (SPEC I3 §1/§2).
 * RSS feeds, scraped pages and our mock dataset all map into this single shape;
 * the rest of the pipeline (normalize → embed → cluster) never sees per-source
 * differences. Everything except `guid`, `sourceSlug` and `title` is optional —
 * external feeds are messy and partial, and `articles/normalize.ts` hardens a
 * record defensively before it ever touches the DB (the anti-bug rule).
 */
export interface RawFeedItem {
  /** Stable per-item id from the source (RSS guid / link). Drives idempotency. */
  guid: string;
  /** Slug of the owning source (one of the 10 — see ./sources.ts). */
  sourceSlug: string;
  title: string;
  author?: string;
  url?: string;
  thumbnailUrl?: string;
  /** Short excerpt only — NEVER the full text of others' articles (copyright). */
  excerpt?: string;
  publishedAt?: string; // ISO timestamp (often partial/odd upstream)
  articleType?: ArticleType;

  // --- detected signals (auto, factual). Providers fill what they can derive;
  //     articles/signals.ts also re-derives from text/URL. Bias *scoring* is I4. ---
  isPaywalled?: boolean;
  hasAffiliateLinks?: boolean;
  isSponsored?: boolean;
  basedOnReviewCopy?: boolean;

  /** Raw game names this article references (resolved via I2's resolveOrQueue). */
  gameRefs?: string[];
}

export interface ArticlePullOptions {
  /** Cap items per source (production respects each source's pullDepth). */
  limit?: number;
}

/**
 * The swappable article-source provider (BLUEPRINT 1.6, SPEC I3 §1). Demo binds
 * this to the MockFeedProvider (bundled dataset, no network); production binds it
 * to the LiveFeedProvider (per-source RSS-first adapters). The clustering engine
 * that consumes the items never changes — only which provider the seam returns.
 */
export interface ArticleSourceProvider {
  readonly name: 'mock' | 'live';

  /** Source slugs this provider can pull (the 10 initial sources). */
  listSourceSlugs(): string[];

  /** Pull recent items for ONE source, already normalized to RawFeedItem. */
  pullSource(sourceSlug: string, opts?: ArticlePullOptions): Promise<RawFeedItem[]>;

  /** Pull recent items across ALL sources (what the ingest job consumes). */
  pullRecent(opts?: ArticlePullOptions): Promise<RawFeedItem[]>;
}
