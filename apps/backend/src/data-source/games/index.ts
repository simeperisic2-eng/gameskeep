import type { GameDataProviderName } from '@gameskeep/shared/constants';
import { isProduction } from '../../config/env';
import type { GameDataProvider } from './types';
import { mockGameProvider } from './mock-provider';
import { liveGameProvider } from './live-provider';

/**
 * The ONE switch point for the game-data seam (SPEC I2 §1; BLUEPRINT 1.6):
 *   demo       → MockProvider (bundled dataset, no network)
 *   production → LiveProvider (IGDB primary → RAWG fallback)
 *
 * Everything else in the app (the catalog importer, the resolve/unmatched flow,
 * the admin) depends only on the GameDataProvider interface, so flipping
 * APP_MODE is the entire change required to go live.
 */
export function getGameDataProvider(): GameDataProvider {
  return isProduction() ? liveGameProvider : mockGameProvider;
}

export interface GameProviderStatus {
  provider: GameDataProviderName;
  live: boolean;
  description: string;
}

/** Human/observable description of the active provider (admin + verify surfaces). */
export function describeGameProvider(): GameProviderStatus {
  const provider = getGameDataProvider();
  const live = provider.name === 'live';
  return {
    provider: provider.name,
    live,
    description: live
      ? 'Live game metadata — IGDB (primary) → RAWG (fallback).'
      : 'Mock game catalog — local bundled dataset, no live calls (demo).',
  };
}

export type { GameDataProvider, NormalizedGame, ProviderListOptions } from './types';
export { isUpcomingGame } from './mock-provider';
