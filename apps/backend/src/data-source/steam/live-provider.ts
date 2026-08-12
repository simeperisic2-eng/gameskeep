import { isProduction } from '../../config/env';
import type { SteamProvider, SteamStorefrontSnapshot } from './types';

/**
 * Live Steam provider (B2) — production-only, guarded to throw in demo (the
 * demo NEVER calls the network).
 *
 * SECURITY: STEAM_API_KEY is read from process.env at call time, travels only
 * in the request URL, and is never logged, thrown, or returned — every error
 * carries an HTTP status only, never a key-bearing URL. (The endpoints used
 * here work keyless too; the key is attached when configured, per Steam's
 * Web API terms.)
 */
const PLAYERS_ENDPOINT =
  'https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/';
const APPDETAILS_ENDPOINT = 'https://store.steampowered.com/api/appdetails';
const APPREVIEWS_ENDPOINT = 'https://store.steampowered.com/appreviews';

function assertProduction(): void {
  if (!isProduction()) {
    throw new Error('Live Steam calls are production-only — demo mode never touches the network.');
  }
}

export const liveSteamProvider: SteamProvider = {
  name: 'live',

  async getCurrentPlayers(appId: number): Promise<number | null> {
    assertProduction();
    const qs = new URLSearchParams({ appid: String(appId) });
    const key = process.env.STEAM_API_KEY;
    if (key) qs.set('key', key);
    const res = await fetch(`${PLAYERS_ENDPOINT}?${qs.toString()}`);
    if (!res.ok) throw new Error(`Steam current-players failed with HTTP ${res.status}.`);
    const body = (await res.json()) as { response?: { player_count?: number; result?: number } };
    const n = body.response?.player_count;
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
  },

  async getStorefrontSnapshot(appId: number): Promise<SteamStorefrontSnapshot | null> {
    assertProduction();
    const [detailsRes, reviewsRes] = await Promise.all([
      fetch(`${APPDETAILS_ENDPOINT}?appids=${appId}&cc=us&l=en`),
      fetch(`${APPREVIEWS_ENDPOINT}/${appId}?json=1&num_per_page=0&purchase_type=all`),
    ]);
    if (!detailsRes.ok) throw new Error(`Steam appdetails failed with HTTP ${detailsRes.status}.`);

    const details = (await detailsRes.json()) as Record<
      string,
      {
        success?: boolean;
        data?: {
          price_overview?: { final?: number; currency?: string; discount_percent?: number };
          dlc?: number[];
        };
      }
    >;
    const entry = details[String(appId)];
    if (!entry?.success || !entry.data) return null;

    let reviewPositivePct: number | null = null;
    let reviewSampleSize: number | null = null;
    if (reviewsRes.ok) {
      const reviews = (await reviewsRes.json()) as {
        query_summary?: { total_positive?: number; total_reviews?: number };
      };
      const total = reviews.query_summary?.total_reviews ?? 0;
      const positive = reviews.query_summary?.total_positive ?? 0;
      if (total > 0) {
        reviewPositivePct = Math.round((positive / total) * 1000) / 10;
        reviewSampleSize = total;
      }
    }

    const price = entry.data.price_overview;
    return {
      priceCents: typeof price?.final === 'number' ? price.final : null,
      currency: price?.currency ?? null,
      discountPct: typeof price?.discount_percent === 'number' ? price.discount_percent : null,
      reviewPositivePct,
      reviewSampleSize,
      dlcAppIds: Array.isArray(entry.data.dlc) ? entry.data.dlc.filter(Number.isFinite) : [],
    };
  },
};
