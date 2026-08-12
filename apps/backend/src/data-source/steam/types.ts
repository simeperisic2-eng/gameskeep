/**
 * Steam data seam (B2; BLUEPRINT 2.3 player counts / prices / DLC) — ONE
 * normalized shape, mirroring the game/article/video seams.
 *
 * Reality this seam encodes honestly: Steam's Web API exposes the CURRENT
 * player count, review summary, price and DLC — it has NO historical
 * player-count endpoint. SteamCharts/SteamDB built their history by recording
 * the current number themselves for years; we do the same (the sweep appends
 * to game_player_counts going forward) and link OUT to SteamDB for the deep
 * past. We never pretend to import history Steam can't give us.
 */
export interface SteamStorefrontSnapshot {
  /** Final price in cents (post-discount) + the discount, from appdetails. */
  priceCents: number | null;
  currency: string | null;
  discountPct: number | null;
  /** Review summary from appreviews (share of positive, sample size). */
  reviewPositivePct: number | null;
  reviewSampleSize: number | null;
  /** DLC app ids listed on the store page (names resolved separately/lazily). */
  dlcAppIds: number[];
}

export interface SteamProvider {
  readonly name: 'mock' | 'live';
  /** Concurrent players right now (GetNumberOfCurrentPlayers). Null = unknown. */
  getCurrentPlayers(appId: number): Promise<number | null>;
  /** Price / review / DLC snapshot from the storefront APIs. Null = unavailable. */
  getStorefrontSnapshot(appId: number): Promise<SteamStorefrontSnapshot | null>;
}
