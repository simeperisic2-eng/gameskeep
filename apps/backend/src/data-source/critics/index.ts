import { isProduction } from '../../config/env';

/**
 * Critic reviews seam (Phase P S5) — OpenCritic as a DORMANT production source,
 * the same pattern as the IGDB / RAWG / Steam seams. Nothing calls it on a
 * schedule yet: in demo the mock returns nothing and never touches the network;
 * in production the live provider needs `OPENCRITIC_API_KEY` (their API is
 * served through RapidAPI) and reads it at call time — the key travels only in
 * a request header and is never logged, thrown or returned (errors carry an
 * HTTP status only). Imported scores would still enter as critic reviews that
 * editors can correct (third-party data = import fixes only).
 */
export interface CriticReviewImport {
  outletName: string;
  nativeScore: number | null;
  scaleMax: number | null;
  /** 0..100 when the outlet scored it. */
  score: number | null;
  url: string | null;
  reviewDate: string | null;
}

export interface CriticProvider {
  readonly name: 'mock' | 'opencritic';
  /** Reviews for one game on the provider (by its own id). Null = unavailable. */
  reviewsFor(providerGameId: number): Promise<CriticReviewImport[] | null>;
}

export const mockCriticProvider: CriticProvider = {
  name: 'mock',
  reviewsFor: () => Promise.resolve(null),
};

const OPENCRITIC_ENDPOINT = 'https://opencritic-api.p.rapidapi.com/reviews/game';

export const openCriticProvider: CriticProvider = {
  name: 'opencritic',
  async reviewsFor(providerGameId: number): Promise<CriticReviewImport[] | null> {
    if (!isProduction()) {
      throw new Error(
        'Live OpenCritic calls are production-only — demo mode never touches the network.',
      );
    }
    const key = process.env.OPENCRITIC_API_KEY;
    if (!key) return null;
    if (!Number.isInteger(providerGameId) || providerGameId <= 0) return null;
    const res = await fetch(`${OPENCRITIC_ENDPOINT}/${providerGameId}`, {
      headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': 'opencritic-api.p.rapidapi.com' },
    });
    if (!res.ok) throw new Error(`OpenCritic reviews failed with HTTP ${res.status}.`);
    const body = (await res.json()) as unknown;
    if (!Array.isArray(body)) return null;
    return body.flatMap((r: unknown): CriticReviewImport[] => {
      const o = (r ?? {}) as Record<string, unknown>;
      const outlet = ((o.Outlet ?? {}) as Record<string, unknown>).name;
      if (typeof outlet !== 'string' || !outlet.trim()) return [];
      const score =
        typeof o.score === 'number' && o.score >= 0 && o.score <= 100 ? Math.round(o.score) : null;
      const npScore = typeof o.npScore === 'number' ? o.npScore : null;
      const npMax = typeof o.npScoreMax === 'number' ? o.npScoreMax : null;
      const url =
        typeof o.externalUrl === 'string' && /^https?:\/\//iu.test(o.externalUrl)
          ? o.externalUrl
          : null;
      const date = typeof o.publishedDate === 'string' ? o.publishedDate.slice(0, 10) : null;
      return [
        {
          outletName: outlet.trim().slice(0, 200),
          nativeScore: npScore,
          scaleMax: npMax,
          score,
          url,
          reviewDate: date && /^\d{4}-\d{2}-\d{2}$/u.test(date) ? date : null,
        },
      ];
    });
  },
};

export function getCriticProvider(): CriticProvider {
  return isProduction() ? openCriticProvider : mockCriticProvider;
}

export function describeCriticProvider(): { provider: string; live: boolean; description: string } {
  const p = getCriticProvider();
  return {
    provider: p.name,
    live: p.name !== 'mock',
    description:
      p.name === 'mock'
        ? 'Mock critic provider — nothing, no network (critic scores come from editors in demo).'
        : 'OpenCritic (dormant until OPENCRITIC_API_KEY is set) — imported scores stay editor-correctable.',
  };
}
