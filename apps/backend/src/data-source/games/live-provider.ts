import type { GameDataProviderName, GameStatus } from '@gameskeep/shared/constants';
import { env } from '../../config/env';
import type { GameDataProvider, NormalizedGame, ProviderListOptions } from './types';

/**
 * LiveProvider — the PRODUCTION game-data source: IGDB (primary) with RAWG
 * (fallback). It is FULLY WIRED but DORMANT in demo: the seam only ever returns
 * it when APP_MODE=production, and every method first asserts the relevant keys
 * exist, throwing a clear, actionable error instead of making a half-configured
 * call. So in demo it is never constructed-and-used and never touches the network
 * (SPEC I2 §1; BLUEPRINT 1.6).
 *
 * Rate-limit awareness (SPEC I2 §1): IGDB allows ~4 requests/second, so calls
 * are throttled to a minimum spacing and retried with exponential backoff on
 * 429/5xx. The initial catalog pull (`listSeed`) is bounded and paginated gently
 * — never hammer an upstream.
 *
 * Setup (production only): IGDB needs a Twitch app → IGDB_CLIENT_ID +
 * IGDB_CLIENT_SECRET (OAuth client-credentials). RAWG needs RAWG_API_KEY. See
 * .env.example, ASSETS.md §3 and OWNER-TODO.md. Demo runs with all of these blank.
 */

const IGDB_OAUTH_URL = 'https://id.twitch.tv/oauth2/token';
const IGDB_API_URL = 'https://api.igdb.com/v4';
const RAWG_API_URL = 'https://api.rawg.io/api';

const IGDB_MIN_INTERVAL_MS = 260; // ~4 req/s ceiling
const MAX_RETRIES = 4;

interface IgdbCompany {
  company?: { name?: string };
  developer?: boolean;
  publisher?: boolean;
}
interface IgdbGame {
  id: number;
  name?: string;
  slug?: string;
  summary?: string;
  storyline?: string;
  first_release_date?: number; // unix seconds
  status?: number; // IGDB release status enum
  genres?: { name?: string }[];
  platforms?: { name?: string }[];
  themes?: { name?: string }[];
  involved_companies?: IgdbCompany[];
  cover?: { url?: string };
  screenshots?: { url?: string }[];
  game_engines?: { name?: string }[];
  collection?: { name?: string };
}

interface RawgGame {
  id: number;
  name?: string;
  slug?: string;
  description_raw?: string;
  released?: string; // YYYY-MM-DD
  tba?: boolean;
  background_image?: string;
  genres?: { name?: string }[];
  platforms?: { platform?: { name?: string } }[];
  developers?: { name?: string }[];
  publishers?: { name?: string }[];
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class LiveGameProvider implements GameDataProvider {
  readonly name: GameDataProviderName = 'live';

  private igdbToken: { value: string; expiresAt: number } | null = null;
  private lastIgdbCallAt = 0;

  // ── IGDB auth + throttled request ──────────────────────────────────────────
  private requireIgdbKeys(): void {
    if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET) {
      throw new Error(
        'LiveProvider: IGDB_CLIENT_ID / IGDB_CLIENT_SECRET are not set. ' +
          'The live game-data path needs Twitch/IGDB credentials (see ASSETS.md §3). ' +
          'Demo mode never reaches this code.',
      );
    }
  }

  private requireRawgKey(): void {
    if (!env.RAWG_API_KEY) {
      throw new Error('LiveProvider: RAWG_API_KEY is not set (fallback unavailable).');
    }
  }

  private async getIgdbToken(): Promise<string> {
    this.requireIgdbKeys();
    const now = Date.now();
    if (this.igdbToken && this.igdbToken.expiresAt > now + 60_000) return this.igdbToken.value;
    const params = new URLSearchParams({
      client_id: env.IGDB_CLIENT_ID,
      client_secret: env.IGDB_CLIENT_SECRET,
      grant_type: 'client_credentials',
    });
    const res = await fetch(`${IGDB_OAUTH_URL}?${params.toString()}`, { method: 'POST' });
    if (!res.ok) throw new Error(`IGDB OAuth failed: HTTP ${res.status}`);
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error('IGDB OAuth: no access_token in response');
    this.igdbToken = {
      value: json.access_token,
      expiresAt: now + (json.expires_in ?? 3600) * 1000,
    };
    return this.igdbToken.value;
  }

  /** Throttled + retried POST to the IGDB apicalypse API. */
  private async igdb<T>(endpoint: string, body: string): Promise<T> {
    const token = await this.getIgdbToken();
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const since = Date.now() - this.lastIgdbCallAt;
      if (since < IGDB_MIN_INTERVAL_MS) await sleep(IGDB_MIN_INTERVAL_MS - since);
      this.lastIgdbCallAt = Date.now();
      const res = await fetch(`${IGDB_API_URL}/${endpoint}`, {
        method: 'POST',
        headers: {
          'Client-ID': env.IGDB_CLIENT_ID,
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        body,
      });
      if (res.ok) return (await res.json()) as T;
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        await sleep(2 ** attempt * 500);
        continue;
      }
      throw new Error(`IGDB ${endpoint} failed: HTTP ${res.status}`);
    }
    throw new Error(`IGDB ${endpoint} failed after ${MAX_RETRIES} retries`);
  }

  private async rawg<T>(path: string, params: Record<string, string>): Promise<T> {
    this.requireRawgKey();
    const search = new URLSearchParams({ key: env.RAWG_API_KEY, ...params });
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const res = await fetch(`${RAWG_API_URL}${path}?${search.toString()}`);
      if (res.ok) return (await res.json()) as T;
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        await sleep(2 ** attempt * 500);
        continue;
      }
      throw new Error(`RAWG ${path} failed: HTTP ${res.status}`);
    }
    throw new Error(`RAWG ${path} failed after ${MAX_RETRIES} retries`);
  }

  // ── mapping → NormalizedGame ────────────────────────────────────────────────
  private static igdbStatus(game: IgdbGame, now: Date): GameStatus {
    if (game.status === 8) return 'delisted';
    if (game.status === 4) return 'early_access';
    if (typeof game.first_release_date === 'number') {
      const released = new Date(game.first_release_date * 1000);
      if (released.getTime() > now.getTime()) return 'in_development';
      return 'released';
    }
    return 'announced';
  }

  private static igdbImage(url: string | undefined, size = 't_cover_big'): string | undefined {
    if (!url) return undefined;
    // IGDB returns protocol-relative thumb URLs; upscale + add scheme.
    return `https:${url.replace('t_thumb', size)}`;
  }

  private static mapIgdb(game: IgdbGame, now: Date): NormalizedGame {
    const companies = game.involved_companies ?? [];
    const developer = companies.find((c) => c.developer)?.company?.name;
    const publisher = companies.find((c) => c.publisher)?.company?.name;
    return {
      externalId: String(game.id),
      name: game.name ?? game.slug ?? `igdb-${game.id}`,
      slug: game.slug,
      summary: game.summary,
      description: game.storyline ?? game.summary,
      status: LiveGameProvider.igdbStatus(game, now),
      releaseDate:
        typeof game.first_release_date === 'number'
          ? new Date(game.first_release_date * 1000).toISOString().slice(0, 10)
          : undefined,
      developer,
      publisher,
      engine: game.game_engines?.[0]?.name,
      series: game.collection?.name,
      genres: (game.genres ?? []).map((x) => x.name).filter((n): n is string => Boolean(n)),
      platforms: (game.platforms ?? []).map((x) => x.name).filter((n): n is string => Boolean(n)),
      tags: (game.themes ?? []).map((x) => x.name).filter((n): n is string => Boolean(n)),
      coverUrl: LiveGameProvider.igdbImage(game.cover?.url),
      screenshots: (game.screenshots ?? [])
        .map((s) => LiveGameProvider.igdbImage(s.url, 't_screenshot_big'))
        .filter((u): u is string => Boolean(u)),
      externalRefs: { igdb: game.id },
    };
  }

  private static mapRawg(game: RawgGame): NormalizedGame {
    const future = game.released
      ? new Date(`${game.released}T00:00:00Z`).getTime() > Date.now()
      : false;
    return {
      externalId: String(game.id),
      name: game.name ?? game.slug ?? `rawg-${game.id}`,
      slug: game.slug,
      description: game.description_raw,
      summary: game.description_raw?.slice(0, 500),
      status: game.tba || future ? 'in_development' : 'released',
      releaseDate: game.released ?? undefined,
      developer: game.developers?.[0]?.name,
      publisher: game.publishers?.[0]?.name,
      genres: (game.genres ?? []).map((x) => x.name).filter((n): n is string => Boolean(n)),
      platforms: (game.platforms ?? [])
        .map((p) => p.platform?.name)
        .filter((n): n is string => Boolean(n)),
      backgroundUrl: game.background_image ?? undefined,
      coverUrl: game.background_image ?? undefined,
      externalRefs: { rawg: game.id },
    };
  }

  private static readonly IGDB_FIELDS =
    'fields name,slug,summary,storyline,first_release_date,status,genres.name,platforms.name,' +
    'themes.name,involved_companies.company.name,involved_companies.developer,' +
    'involved_companies.publisher,cover.url,screenshots.url,game_engines.name,collection.name;';

  // ── GameDataProvider — IGDB primary, RAWG fallback ──────────────────────────
  async search(query: string, opts: ProviderListOptions = {}): Promise<NormalizedGame[]> {
    const limit = opts.limit ?? 20;
    const safe = query.replace(/"/g, '');
    try {
      const games = await this.igdb<IgdbGame[]>(
        'games',
        `search "${safe}"; ${LiveGameProvider.IGDB_FIELDS} limit ${limit};`,
      );
      const now = new Date();
      return games.map((g) => LiveGameProvider.mapIgdb(g, now));
    } catch {
      const res = await this.rawg<{ results?: RawgGame[] }>('/games', {
        search: query,
        page_size: String(limit),
      });
      return (res.results ?? []).map(LiveGameProvider.mapRawg);
    }
  }

  async getByExternalId(externalId: string): Promise<NormalizedGame | null> {
    try {
      const games = await this.igdb<IgdbGame[]>(
        'games',
        `where id = ${Number(externalId)}; ${LiveGameProvider.IGDB_FIELDS} limit 1;`,
      );
      const game = games[0];
      return game ? LiveGameProvider.mapIgdb(game, new Date()) : null;
    } catch {
      const game = await this.rawg<RawgGame>(`/games/${encodeURIComponent(externalId)}`, {});
      return game?.id ? LiveGameProvider.mapRawg(game) : null;
    }
  }

  async resolveByName(name: string): Promise<NormalizedGame | null> {
    const [best] = await this.search(name, { limit: 1 });
    return best ?? null;
  }

  async listUpcoming(opts: ProviderListOptions = {}): Promise<NormalizedGame[]> {
    const limit = opts.limit ?? 40;
    const nowUnix = Math.floor(Date.now() / 1000);
    const games = await this.igdb<IgdbGame[]>(
      'games',
      `where first_release_date > ${nowUnix}; ${LiveGameProvider.IGDB_FIELDS} ` +
        `sort first_release_date asc; limit ${limit};`,
    );
    const now = new Date();
    return games.map((g) => LiveGameProvider.mapIgdb(g, now));
  }

  /** Gentle, bounded seed pull — popular titles, paginated, throttled. */
  async listSeed(opts: ProviderListOptions = {}): Promise<NormalizedGame[]> {
    const target = Math.min(opts.limit ?? 300, 500);
    const pageSize = 100;
    const out: NormalizedGame[] = [];
    const now = new Date();
    for (let offset = 0; offset < target; offset += pageSize) {
      const page = await this.igdb<IgdbGame[]>(
        'games',
        `where total_rating_count != null & version_parent = null; ${LiveGameProvider.IGDB_FIELDS} ` +
          `sort total_rating_count desc; limit ${Math.min(pageSize, target - offset)}; offset ${offset};`,
      );
      if (page.length === 0) break;
      out.push(...page.map((g) => LiveGameProvider.mapIgdb(g, now)));
    }
    return out;
  }
}

export const liveGameProvider = new LiveGameProvider();
