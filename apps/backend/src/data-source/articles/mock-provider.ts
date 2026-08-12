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

export class MockFeedProvider implements ArticleSourceProvider {
  readonly name = 'mock' as const;

  private readonly all: RawFeedItem[];

  constructor(dataset: RawFeedItem[] = MOCK_FEED_ITEMS) {
    this.all = dataset.map(withPermalink);
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

export const mockFeedProvider = new MockFeedProvider();
