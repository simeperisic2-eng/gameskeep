import { isProduction } from '../../config/env';
import type { SteamProvider } from './types';
import { mockSteamProvider } from './mock-provider';
import { liveSteamProvider } from './live-provider';

/**
 * The ONE switch point for the Steam seam (B2, same pattern as the game/
 * article/video seams): demo → mock (nothing, no network), production → the
 * Steam Web API + storefront endpoints.
 */
export function getSteamProvider(): SteamProvider {
  return isProduction() ? liveSteamProvider : mockSteamProvider;
}

export interface SteamProviderStatus {
  provider: 'mock' | 'live';
  live: boolean;
  description: string;
}

/** Human/observable description of the active provider (readiness + verify). */
export function describeSteamProvider(): SteamProviderStatus {
  const provider = getSteamProvider();
  const live = provider.name === 'live';
  return {
    provider: provider.name,
    live,
    description: live
      ? 'Live Steam Web API — current players + storefront snapshot (history accumulates from our sweeps; Steam has no past-players API).'
      : 'Mock Steam provider — no data, no network; demo player history comes from the seed.',
  };
}

export type { SteamProvider, SteamStorefrontSnapshot } from './types';
