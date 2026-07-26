import { isProduction } from '../../config/env';
import type { ArticleSourceProvider } from './types';
import { mockFeedProvider } from './mock-provider';
import { liveFeedProvider } from './live-provider';

/**
 * The ONE switch point for the article-source seam (SPEC I3 §1; BLUEPRINT 1.6),
 * mirroring the game-data seam from I2:
 *   demo       → MockFeedProvider (bundled mock feed, no network)
 *   production → LiveFeedProvider (per-source RSS-first adapters)
 *
 * The clustering pipeline depends only on the ArticleSourceProvider interface,
 * so flipping APP_MODE is the entire change required to go live.
 */
export function getArticleSourceProvider(): ArticleSourceProvider {
  return isProduction() ? liveFeedProvider : mockFeedProvider;
}

export interface ArticleSourceStatus {
  provider: 'mock' | 'live';
  live: boolean;
  sources: number;
  description: string;
}

/** Human/observable description of the active feed provider (admin + verify). */
export function describeArticleSource(): ArticleSourceStatus {
  const provider = getArticleSourceProvider();
  const live = provider.name === 'live';
  return {
    provider: provider.name,
    live,
    sources: provider.listSourceSlugs().length,
    description: live
      ? 'Live article feed — per-source RSS adapters (production).'
      : 'Mock article feed — local bundled dataset, no live calls (demo).',
  };
}

export type { ArticleSourceProvider, RawFeedItem, ArticlePullOptions } from './types';
