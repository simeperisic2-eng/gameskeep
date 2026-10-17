import { isProduction } from '../../config/env';
import type { SteamRawReview, SteamReviewBatch, SteamReviewsProvider } from './types';

/**
 * Steam recent reviews (Phase P S5) — the seam behind the weekly "AI summary of
 * N Steam reviews" job. Demo: deterministic MOCK reviews (no network) — some
 * quote other reviewers by name, so the scrubbing is exercised. Production:
 * the public appreviews endpoint (no key needed), newest first, paged by cursor.
 * Errors carry an HTTP status only.
 */

// ── mock (demo) ───────────────────────────────────────────────────────────────
const MOCK_PERSONAS = [
  'NightOwl_42',
  'Kestrel Vale',
  'pixelpilgrim',
  'Captain Crumb',
  'Mara.exe',
  'xXFrostbiteXx',
  'TheLastBard',
  'ZephyrRune',
];
const MOCK_POSITIVE = [
  'The combat feels tight and every build I tried was viable.',
  'The latest patch fixed the crashes I had in the second act.',
  'Co-op with friends is the best part, sessions fly by.',
  'Performance on my mid-range PC is smooth after the update.',
  'The writing and voice acting carry the whole experience.',
  'Plenty of content for the price and the developers keep adding more.',
  'Exploration is rewarding and the world feels handcrafted.',
];
const MOCK_NEGATIVE = [
  'Frame rate drops in the busiest areas are still a problem.',
  'The new monetisation changes feel out of place in a paid game.',
  'Matchmaking takes far too long outside peak hours.',
  'The late game drags and the difficulty spikes feel unfair.',
];

function seeded(appId: number): () => number {
  let x = (appId * 2654435761) >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}

/** Deterministic mock reviews for an app id (pure; same id → same batch). */
export function mockReviewBatch(
  appId: number,
  opts: { days: number; max: number },
): SteamReviewBatch {
  const rnd = seeded(appId);
  // Some games sit below the default threshold of 50 on purpose.
  const total = Math.floor(10 + rnd() * 240);
  const positiveShare = 0.55 + rnd() * 0.4;
  const read = Math.min(total, Math.max(0, opts.max));
  const reviews: SteamRawReview[] = [];
  const now = Date.now();
  for (let i = 0; i < read; i += 1) {
    const up = rnd() < positiveShare;
    const pool = up ? MOCK_POSITIVE : MOCK_NEGATIVE;
    const author = MOCK_PERSONAS[Math.floor(rnd() * MOCK_PERSONAS.length)]!;
    let text = pool[Math.floor(rnd() * pool.length)]!;
    // Every fifth review quotes the previous reviewer (name + profile link) — scrubbed later.
    const previous = reviews[reviews.length - 1]?.authorName;
    if (i % 5 === 4 && previous) {
      const other = previous;
      text = `Agree with ${other} here. ${text} See steamcommunity.com/id/${other.replace(/\W/gu, '').toLowerCase()} for more.`;
    }
    reviews.push({
      text,
      votedUp: up,
      createdAt: Math.floor((now - rnd() * opts.days * 86_400_000) / 1000),
      authorName: author,
      authorId: `7656119${String(Math.floor(rnd() * 1e10)).padStart(10, '0')}`,
    });
  }
  const positive = reviews.filter((r) => r.votedUp).length;
  return {
    reviews,
    totalInWindow: total,
    positiveInWindow: read > 0 ? Math.round((positive / read) * total) : 0,
  };
}

export const mockSteamReviewsProvider: SteamReviewsProvider = {
  name: 'mock',
  recentReviews(appId, opts) {
    if (!Number.isInteger(appId) || appId <= 0) return Promise.resolve(null);
    return Promise.resolve(mockReviewBatch(appId, opts));
  },
};

// ── live (production) ─────────────────────────────────────────────────────────
const APPREVIEWS_ENDPOINT = 'https://store.steampowered.com/appreviews';

export const liveSteamReviewsProvider: SteamReviewsProvider = {
  name: 'live',
  async recentReviews(appId, opts) {
    if (!isProduction()) {
      throw new Error(
        'Live Steam calls are production-only — demo mode never touches the network.',
      );
    }
    if (!Number.isInteger(appId) || appId <= 0) return null;
    const reviews: SteamRawReview[] = [];
    let cursor = '*';
    let totalInWindow = 0;
    let positiveInWindow = 0;
    for (let page = 0; page < 20 && reviews.length < opts.max; page += 1) {
      const qs = new URLSearchParams({
        json: '1',
        filter: 'recent',
        language: 'english',
        purchase_type: 'all',
        day_range: String(opts.days),
        num_per_page: String(Math.min(100, opts.max - reviews.length)),
        cursor,
      });
      const res = await fetch(`${APPREVIEWS_ENDPOINT}/${appId}?${qs.toString()}`);
      if (!res.ok) throw new Error(`Steam appreviews failed with HTTP ${res.status}.`);
      const body = (await res.json()) as {
        success?: number;
        cursor?: string;
        query_summary?: { total_reviews?: number; total_positive?: number };
        reviews?: {
          review?: string;
          voted_up?: boolean;
          timestamp_created?: number;
          author?: { steamid?: string; personaname?: string };
        }[];
      };
      if (body.success !== 1) break;
      if (page === 0) {
        totalInWindow = Number(body.query_summary?.total_reviews ?? 0) || 0;
        positiveInWindow = Number(body.query_summary?.total_positive ?? 0) || 0;
      }
      const batch = Array.isArray(body.reviews) ? body.reviews : [];
      for (const r of batch) {
        if (typeof r.review !== 'string') continue;
        reviews.push({
          text: r.review.slice(0, 4000),
          votedUp: r.voted_up === true,
          createdAt: typeof r.timestamp_created === 'number' ? r.timestamp_created : null,
          authorName: typeof r.author?.personaname === 'string' ? r.author.personaname : null,
          authorId: typeof r.author?.steamid === 'string' ? r.author.steamid : null,
        });
      }
      if (batch.length === 0 || !body.cursor || body.cursor === cursor) break;
      cursor = body.cursor;
    }
    return { reviews, totalInWindow, positiveInWindow };
  },
};

export function getSteamReviewsProvider(): SteamReviewsProvider {
  return isProduction() ? liveSteamReviewsProvider : mockSteamReviewsProvider;
}
