import { describe, it, expect } from 'vitest';
import { sanitizeFeedItem } from '../src/articles/normalize';
import { detectSignals } from '../src/articles/signals';
import { centroid, decideCluster, normalize, toVectorLiteral } from '../src/articles/embedding';
import { MOCK_FEED_ITEMS } from '../src/data-source/articles/mock-data';
import { SOURCE_SLUGS } from '../src/data-source/articles/sources';
import { describeArticleSource, getArticleSourceProvider } from '../src/data-source/articles';
import { liveFeedProvider } from '../src/data-source/articles/live-provider';
import { mockFeedProvider } from '../src/data-source/articles/mock-provider';

// All hermetic — no DB, no network. The embed→cluster→summarize DB path runs
// against the booted stack via scripts/i3-check.mjs.

describe('sanitizeFeedItem (defensive normalization)', () => {
  it('returns null without a usable title / guid / source', () => {
    expect(sanitizeFeedItem(null)).toBeNull();
    expect(sanitizeFeedItem({})).toBeNull();
    expect(sanitizeFeedItem({ title: 'x', guid: 'g' })).toBeNull(); // no source
    expect(sanitizeFeedItem({ title: '  ', guid: 'g', sourceSlug: 'ign' })).toBeNull();
  });

  it('never throws on partial / oddly-typed input', () => {
    const clean = sanitizeFeedItem({
      guid: 'abc',
      sourceSlug: 'ign',
      title: 'A'.repeat(1000),
      url: 'javascript:alert(1)',
      thumbnailUrl: 'not a url',
      publishedAt: 'not-a-date',
      articleType: 'totally-made-up' as never,
      excerpt: 'short excerpt',
      gameRefs: ['Elden Ring', 'Elden Ring', 42, ''] as never,
    });
    expect(clean).not.toBeNull();
    expect(clean!.title.length).toBe(300); // clamped
    expect(clean!.url).toBeUndefined(); // non-http rejected
    expect(clean!.thumbnailUrl).toBeUndefined();
    expect(clean!.publishDate).toBeUndefined(); // bad date dropped, no throw
    expect(clean!.articleType).toBe('news'); // unknown type → safe default
    expect(clean!.gameRefs).toEqual(['Elden Ring']); // deduped, junk dropped
    expect(clean!.embedText).toContain('short excerpt');
  });

  it('keeps a valid item intact', () => {
    const clean = sanitizeFeedItem({
      guid: 'gta6-delay-ign',
      sourceSlug: 'ign',
      title: 'GTA 6 Delayed',
      url: 'https://www.ign.com/a',
      publishedAt: '2026-06-02T08:00:00Z',
      articleType: 'news',
    });
    expect(clean!.guid).toBe('gta6-delay-ign');
    expect(clean!.slug).toBe('gta-6-delayed');
    expect(clean!.publishDate?.getUTCFullYear()).toBe(2026);
  });
});

describe('detectSignals (factual signal capture)', () => {
  const base = sanitizeFeedItem({ guid: 'g', sourceSlug: 'ign', title: 'Some article' })!;

  it('keeps explicit provider signals', () => {
    const signals = detectSignals({ ...base, hasAffiliateLinks: true, isSponsored: true });
    expect(signals.hasAffiliateLinks).toBe(true);
    expect(signals.isSponsored).toBe(true);
  });

  it('derives signals from text + treats reviews as review-copy', () => {
    const sponsored = detectSignals({
      ...base,
      title: 'Sponsored: build a gaming PC',
    });
    expect(sponsored.isSponsored).toBe(true);

    const deal = detectSignals({ ...base, title: 'The best Elden Ring deals this week' });
    expect(deal.hasAffiliateLinks).toBe(true);

    const review = detectSignals({ ...base, articleType: 'review' });
    expect(review.basedOnReviewCopy).toBe(true);
  });
});

describe('clustering decision (pure)', () => {
  it('attaches to the most-similar candidate at/above threshold, else creates', () => {
    const candidates = [
      { topicId: 't1', similarity: 0.4 },
      { topicId: 't2', similarity: 0.62 },
    ];
    expect(decideCluster(candidates, 0.5)).toMatchObject({ action: 'attach', topicId: 't2' });
    expect(decideCluster(candidates, 0.7)).toMatchObject({ action: 'create' });
    expect(decideCluster([], 0.5)).toMatchObject({ action: 'create' });
  });
});

describe('vector helpers', () => {
  it('formats a pgvector literal', () => {
    expect(toVectorLiteral([0.1, 0.2, 0.3])).toBe('[0.1,0.2,0.3]');
  });
  it('normalizes to unit length', () => {
    const n = normalize([3, 4]);
    expect(Math.hypot(n[0]!, n[1]!)).toBeCloseTo(1, 6);
  });
  it('centroid averages then re-normalizes', () => {
    const c = centroid([
      [1, 0],
      [0, 1],
    ]);
    expect(Math.hypot(c[0]!, c[1]!)).toBeCloseTo(1, 6);
    expect(c[0]).toBeCloseTo(c[1]!, 6);
  });
});

describe('mock feed dataset (clustering has real groupings to find)', () => {
  it('is a broad feed with unique guids across the 10 sources', () => {
    expect(MOCK_FEED_ITEMS.length).toBeGreaterThanOrEqual(200);
    const guids = MOCK_FEED_ITEMS.map((i) => i.guid);
    expect(new Set(guids).size).toBe(guids.length);
    for (const item of MOCK_FEED_ITEMS) {
      expect(SOURCE_SLUGS).toContain(item.sourceSlug);
      expect(item.title.trim().length).toBeGreaterThan(0);
    }
  });

  it('has a multi-source single event (GTA 6 delay across ≥4 outlets)', () => {
    const delay = MOCK_FEED_ITEMS.filter((i) => i.guid.startsWith('gta6-delay-'));
    expect(delay.length).toBeGreaterThanOrEqual(5);
    expect(new Set(delay.map((i) => i.sourceSlug)).size).toBeGreaterThanOrEqual(4);
  });

  it('has THREE distinct GTA 6 events (same game, different stories)', () => {
    for (const key of ['gta6-delay-', 'gta6-trailer-', 'gta6-mapleak-']) {
      expect(MOCK_FEED_ITEMS.some((i) => i.guid.startsWith(key))).toBe(true);
    }
  });

  it('references catalog games and at least one unknown game (resolveOrQueue)', () => {
    const refs = MOCK_FEED_ITEMS.flatMap((i) => i.gameRefs ?? []);
    expect(refs).toContain('Grand Theft Auto VI');
    expect(refs).toContain('Cyberpunk 2077');
    expect(refs).toContain('Chronowraith Saga IX'); // intentionally not in the catalog
  });

  it('includes the time-window test pair', () => {
    expect(MOCK_FEED_ITEMS.some((i) => i.guid.startsWith('helldivers-window-old'))).toBe(true);
    expect(MOCK_FEED_ITEMS.some((i) => i.guid.startsWith('helldivers-window-new'))).toBe(true);
  });
});

describe('article-source seam (demo ↔ production switch)', () => {
  it('returns the Mock feed provider in demo mode', () => {
    expect(getArticleSourceProvider().name).toBe('mock');
    const status = describeArticleSource();
    expect(status.provider).toBe('mock');
    expect(status.live).toBe(false);
    expect(status.sources).toBe(10);
  });

  it('the mock provider pulls per source and across all sources, no network', async () => {
    const ign = await mockFeedProvider.pullSource('ign');
    expect(ign.length).toBeGreaterThan(0);
    expect(ign.every((i) => i.sourceSlug === 'ign')).toBe(true);
    const all = await mockFeedProvider.pullRecent();
    expect(all.length).toBe(MOCK_FEED_ITEMS.length);
  });

  it('the Live feed provider is dormant in demo (throws, never fetches)', async () => {
    await expect(liveFeedProvider.pullRecent()).rejects.toThrow(/dormant/i);
    await expect(liveFeedProvider.pullSource('ign')).rejects.toThrow(/dormant/i);
  });
});
