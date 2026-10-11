import { isDemo } from '../../config/env';
import { slugify } from '../../lib/slug';
import type { ArticlePullOptions, ArticleSourceProvider, RawFeedItem } from './types';
import { MOCK_FEED_ITEMS } from './mock-data';
import { SOURCE_BY_SLUG, SOURCE_SLUGS } from './sources';

/**
 * MockFeedProvider — the DEMO article source (SPEC I3 §1). Serves the bundled
 * mock feed and makes NO network calls. The data is already in the normalized
 * RawFeedItem shape, so per-source "adapters" are trivial here; the real RSS
 * mapping lives in the LiveFeedProvider. Switching APP_MODE to production is the
 * only change needed to go live (BLUEPRINT 1.6).
 *
 * B1: every item carries a realistic per-source permalink
 * ({source.website}/articles/{title-slug}) so the "Read at {source} ↗" /
 * headline links actually resolve in the demo — excerpt + LINK only, the I1
 * copyright posture. Derived (not stored per item) so the 300+-item dataset
 * stays lean; live RSS items bring their real URLs. Idempotency is untouched
 * (the guid is the dedupe key).
 */
function withPermalink(item: RawFeedItem): RawFeedItem {
  if (item.url) return item; // an explicit URL in the dataset always wins
  const site = SOURCE_BY_SLUG.get(item.sourceSlug)?.websiteUrl;
  if (!site) return item;
  return { ...item, url: `${site.replace(/\/$/, '')}/articles/${slugify(item.title)}` };
}

/**
 * Shift every dated item by one offset so the NEWEST lands at `anchor` — the
 * relative spacing (developing stories, the clustering time window, stale-topic
 * resolution) is untouched (Phase P hygiene 3). Undated / unparseable items pass
 * through as they are (the normalizer handles them).
 */
export function anchorFeedDates(items: RawFeedItem[], anchor: Date): RawFeedItem[] {
  const times = items.map((i) => Date.parse(i.publishedAt ?? '')).filter((t) => Number.isFinite(t));
  if (times.length === 0 || !Number.isFinite(anchor.getTime())) return items;
  const shift = anchor.getTime() - Math.max(...times);
  return items.map((i) => {
    const t = Date.parse(i.publishedAt ?? '');
    return Number.isFinite(t) ? { ...i, publishedAt: new Date(t + shift).toISOString() } : i;
  });
}

export class MockFeedProvider implements ArticleSourceProvider {
  readonly name = 'mock' as const;

  private readonly all: RawFeedItem[];

  constructor(dataset: RawFeedItem[] = MOCK_FEED_ITEMS, opts: { anchor?: Date | null } = {}) {
    const anchored = opts.anchor ? anchorFeedDates(dataset, opts.anchor) : dataset;
    this.all = anchored.map(withPermalink);
  }

  listSourceSlugs(): string[] {
    return [...SOURCE_SLUGS];
  }

  async pullSource(sourceSlug: string, opts: ArticlePullOptions = {}): Promise<RawFeedItem[]> {
    const items = this.all.filter((item) => item.sourceSlug === sourceSlug);
    return typeof opts.limit === 'number' ? items.slice(0, opts.limit) : items;
  }

  async pullRecent(opts: ArticlePullOptions = {}): Promise<RawFeedItem[]> {
    if (typeof opts.limit !== 'number') return [...this.all];
    // Apply the cap PER SOURCE (mirrors the live per-source pullDepth) so a small
    // limit doesn't starve later sources.
    const out: RawFeedItem[] = [];
    for (const slug of this.listSourceSlugs()) {
      out.push(...this.all.filter((i) => i.sourceSlug === slug).slice(0, opts.limit));
    }
    return out;
  }
}

/**
 * Where the demo feed's newest article lands: ten minutes before this process
 * booted — the briefing's "today" and S2's time-window deltas have recent data on
 * both sides. Demo mode only; the bundled dataset is unchanged.
 */
export const DEMO_FEED_ANCHOR: Date | null = isDemo()
  ? new Date(Date.now() - 10 * 60 * 1000)
  : null;

/** The demo feed, anchored at `DEMO_FEED_ANCHOR`. */
export const mockFeedProvider = new MockFeedProvider(MOCK_FEED_ITEMS, { anchor: DEMO_FEED_ANCHOR });
