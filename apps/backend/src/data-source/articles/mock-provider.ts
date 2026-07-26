import type { ArticlePullOptions, ArticleSourceProvider, RawFeedItem } from './types';
import { MOCK_FEED_ITEMS } from './mock-data';
import { SOURCE_SLUGS } from './sources';

/**
 * MockFeedProvider — the DEMO article source (SPEC I3 §1). Serves the bundled
 * mock feed and makes NO network calls. The data is already in the normalized
 * RawFeedItem shape, so per-source "adapters" are trivial here; the real RSS
 * mapping lives in the LiveFeedProvider. Switching APP_MODE to production is the
 * only change needed to go live (BLUEPRINT 1.6).
 */
export class MockFeedProvider implements ArticleSourceProvider {
  readonly name = 'mock' as const;

  private readonly all: RawFeedItem[];

  constructor(dataset: RawFeedItem[] = MOCK_FEED_ITEMS) {
    this.all = dataset;
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
