import type { GameDataProviderName, GameStatus } from '@gameskeep/shared/constants';

/**
 * The ONE normalized Game shape every provider returns (SPEC I2 §1). IGDB and
 * RAWG expose wildly different fields; each provider maps its source into this
 * shape so the rest of the platform never sees provider differences. It mirrors
 * the I1 `gameCreate` input (a Game is a Subject specialization — `name`/`slug`
 * live on the Subject, the rest on the Game row).
 *
 * Everything except `name` is optional/nullable on purpose: external data is
 * messy and partial. `catalog/normalize.ts` hardens a record before it ever
 * touches the DB (the anti-bug rule — never trust external shape).
 */
export interface NormalizedGame {
  /** Provider-specific stable id (mock: the slug; IGDB/RAWG: their numeric id). */
  externalId: string;
  name: string;
  slug?: string;
  summary?: string;
  description?: string;
  status?: GameStatus;
  releaseDate?: string; // YYYY-MM-DD (often partial/unknown upstream)
  developer?: string;
  publisher?: string;
  engine?: string;
  ageRatingSystem?: string; // PEGI / ESRB
  ageRatingValue?: string;
  series?: string;
  mode?: string[]; // singleplayer / multiplayer / co-op
  genres?: string[];
  platforms?: string[];
  tags?: string[];
  screenshots?: string[];
  coverUrl?: string;
  backgroundUrl?: string;
  socialLinks?: Record<string, string>;
  steamAppId?: number;
  hltbMainHours?: number;
  hltbCompletionistHours?: number;
  steamCompletionRate?: number;
  /** Provider id mapping, e.g. { igdb: "1234", rawg: "5678", mock: "elden-ring" }. */
  externalRefs?: Record<string, string | number>;
}

export interface ProviderListOptions {
  /** Cap the number of results (providers paginate/limit gently — rate limits). */
  limit?: number;
}

/**
 * The swappable game-data provider (BLUEPRINT 1.6). Demo binds this to the
 * MockProvider (local dataset, no network); production binds it to the
 * LiveProvider (IGDB primary → RAWG fallback). Engines that consume games never
 * change — only which provider the seam returns does.
 */
export interface GameDataProvider {
  readonly name: GameDataProviderName;

  /** Free-text search by name. Returns best matches, already normalized. */
  search(query: string, opts?: ProviderListOptions): Promise<NormalizedGame[]>;

  /** Fetch a single game by this provider's external id (null if unknown). */
  getByExternalId(externalId: string): Promise<NormalizedGame | null>;

  /**
   * Resolve a single best-match game by a raw name (the auto-resolve path the
   * I3 article pipeline calls). Null when the provider can't identify it.
   */
  resolveByName(name: string): Promise<NormalizedGame | null>;

  /** Games with a future release / upcoming status (for the Upcoming view, I5). */
  listUpcoming(opts?: ProviderListOptions): Promise<NormalizedGame[]>;

  /**
   * The catalog to bulk-load into the DB — the broad demo seed. In production
   * this is a gentle, bounded, rate-limit-aware pull; in demo it's the bundled
   * dataset. The catalog import job (off the request path) consumes this.
   */
  listSeed(opts?: ProviderListOptions): Promise<NormalizedGame[]>;
}
