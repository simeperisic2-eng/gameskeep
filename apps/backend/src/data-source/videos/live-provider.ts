import { isProduction } from '../../config/env';
import type { VideoCandidate, VideoSearchProvider } from './types';

/**
 * Live video search — YouTube Data API v3 `search.list` (A2). Production-only:
 * guarded to throw in demo (the demo NEVER calls the network) and when the key
 * is missing. SECURITY: the API key travels only in the request URL and is
 * never logged, thrown, or returned — errors carry status codes only.
 *
 * This SEARCHES for candidates (title/channel/thumbnail); the stored, editor-
 * curated list is what renders. We never embed players or pull video content.
 */
const SEARCH_ENDPOINT = 'https://www.googleapis.com/youtube/v3/search';

interface YouTubeSearchItem {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    liveBroadcastContent?: string;
    thumbnails?: { high?: { url?: string }; medium?: { url?: string } };
  };
}

/** Coarse keyword classification — an editor corrects misfits (auto + override). */
function classifyKind(title: string): string {
  const t = title.toLowerCase();
  if (/\btrailer\b|\bteaser\b|\breveal\b/.test(t)) return 'trailer';
  if (/\breview\b|\bverdict\b/.test(t)) return 'review';
  return 'gameplay';
}

export const liveVideoProvider: VideoSearchProvider = {
  name: 'live',
  async search(gameName: string, limit = 6): Promise<VideoCandidate[]> {
    if (!isProduction()) {
      throw new Error('Live video search is production-only — demo mode never calls the network.');
    }
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) {
      throw new Error(
        'YOUTUBE_API_KEY is not configured (see ASSETS.md §3) — video autofill unavailable.',
      );
    }

    const qs = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      maxResults: String(Math.min(Math.max(limit, 1), 10)),
      q: `${gameName} game`,
      safeSearch: 'none',
      key,
    });
    const res = await fetch(`${SEARCH_ENDPOINT}?${qs.toString()}`);
    if (!res.ok) {
      // Status only — never echo the URL (it carries the key).
      throw new Error(`YouTube search failed with HTTP ${res.status}.`);
    }
    const body = (await res.json()) as { items?: YouTubeSearchItem[] };

    const out: VideoCandidate[] = [];
    for (const item of body.items ?? []) {
      const videoId = item.id?.videoId;
      const title = item.snippet?.title?.trim();
      if (!videoId || !title) continue; // never trust external shape
      out.push({
        videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
        title: title.slice(0, 300),
        channel: item.snippet?.channelTitle?.slice(0, 120) ?? null,
        thumbnailUrl:
          item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.medium?.url ?? null,
        kind: classifyKind(title),
      });
      if (out.length >= limit) break;
    }
    return out;
  },
};
