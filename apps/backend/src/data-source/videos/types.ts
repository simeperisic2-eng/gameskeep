/**
 * Video-search seam (A2; BLUEPRINT 2.3 "Videos & streams") — ONE normalized
 * candidate shape, mirroring the article/game seams. The provider only SEARCHES
 * (title/channel/thumbnail/URL); we never embed players or ingest content —
 * thumbnails link out to the provider (legal posture: link/API, never scrape).
 */
export interface VideoCandidate {
  /** Canonical watch URL (outbound — the card links here). */
  videoUrl: string;
  title: string;
  channel: string | null;
  /** Provider thumbnail URL (null → the frontend renders its designed cover). */
  thumbnailUrl: string | null;
  /** trailer | review | gameplay — coarse, keyword-classified; editor-correctable. */
  kind: string;
}

export interface VideoSearchProvider {
  readonly name: 'mock' | 'live';
  /** Search videos relevant to a game name. Returns up to `limit` candidates. */
  search(gameName: string, limit?: number): Promise<VideoCandidate[]>;
}
