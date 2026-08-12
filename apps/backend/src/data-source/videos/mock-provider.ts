import type { VideoCandidate, VideoSearchProvider } from './types';

/**
 * Demo video provider — returns NO candidates, by design. The demo's video rows
 * come from the seed (title + channel, thumbnail null → designed placeholder),
 * so autofill has nothing to do and the demo never touches the network. The
 * interface stays identical to the live provider, so production is a mode flip.
 */
export const mockVideoProvider: VideoSearchProvider = {
  name: 'mock',
  search(): Promise<VideoCandidate[]> {
    return Promise.resolve([]);
  },
};
