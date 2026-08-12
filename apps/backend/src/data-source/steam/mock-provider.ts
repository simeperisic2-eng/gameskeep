import type { SteamProvider, SteamStorefrontSnapshot } from './types';

/**
 * Demo Steam provider — returns NOTHING, by design, and never touches the
 * network. The demo's player history comes from the seed (a realistic
 * launch→decay→bump→settle series); the sweep, if it ever ran in demo, would
 * append nothing. The interface matches the live provider exactly, so
 * production is a mode flip.
 */
export const mockSteamProvider: SteamProvider = {
  name: 'mock',
  getCurrentPlayers(): Promise<number | null> {
    return Promise.resolve(null);
  },
  getStorefrontSnapshot(): Promise<SteamStorefrontSnapshot | null> {
    return Promise.resolve(null);
  },
};
