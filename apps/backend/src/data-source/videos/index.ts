import { eq, sql } from 'drizzle-orm';
import { isProduction } from '../../config/env';
import { db } from '../../db/client';
import { gameVideos } from '../../db/schema';
import type { VideoCandidate, VideoSearchProvider } from './types';
import { mockVideoProvider } from './mock-provider';
import { liveVideoProvider } from './live-provider';

/**
 * The ONE switch point for the video seam (A2, same pattern as the game/article
 * seams): demo → mock (no candidates, no network), production → YouTube Data API.
 */
export function getVideoSearchProvider(): VideoSearchProvider {
  return isProduction() ? liveVideoProvider : mockVideoProvider;
}

export interface VideoProviderStatus {
  provider: 'mock' | 'live';
  live: boolean;
  description: string;
}

/** Human/observable description of the active provider (admin + verify surfaces). */
export function describeVideoProvider(): VideoProviderStatus {
  const provider = getVideoSearchProvider();
  const live = provider.name === 'live';
  return {
    provider: provider.name,
    live,
    description: live
      ? 'Live video search — YouTube Data API v3 (candidates only; editor curates).'
      : 'Mock video search — no candidates, no network; demo videos come from the seed.',
  };
}

export interface AutofillResult {
  added: number;
  skipped: boolean;
  reason: string;
}

/**
 * Auto-fill a game's video slots (A2 "auto + manual override"): the provider
 * proposes candidates, but ONLY when the game has no stored videos — a curated
 * list (editor pins/reorders/removes via the game-videos admin resource) is
 * never touched by automation. Display takes pinned-first → sort → top 3.
 */
export async function autofillGameVideos(
  gameId: string,
  gameName: string,
): Promise<AutofillResult> {
  const [existing] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(gameVideos)
    .where(eq(gameVideos.gameId, gameId));
  if ((existing?.n ?? 0) > 0) {
    return {
      added: 0,
      skipped: true,
      reason: 'curated list present — auto only fills empty slots',
    };
  }

  const provider = getVideoSearchProvider();
  const candidates: VideoCandidate[] = await provider.search(gameName, 3);
  if (candidates.length === 0) {
    return {
      added: 0,
      skipped: false,
      reason: provider.name === 'mock' ? 'mock provider proposes nothing (demo)' : 'no results',
    };
  }

  await db.insert(gameVideos).values(
    candidates.slice(0, 3).map((c, i) => ({
      gameId,
      provider: 'youtube' as const,
      videoUrl: c.videoUrl,
      title: c.title,
      channel: c.channel,
      thumbnailUrl: c.thumbnailUrl,
      kind: c.kind,
      sort: i,
    })),
  );
  return { added: Math.min(candidates.length, 3), skipped: false, reason: 'filled empty slots' };
}

export type { VideoCandidate, VideoSearchProvider } from './types';
