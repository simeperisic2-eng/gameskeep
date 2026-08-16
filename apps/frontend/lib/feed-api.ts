import { cookies } from 'next/headers';

/**
 * Server-side client for the PER-USER follow feed (SPEC I6, Slice 6). Forwards
 * the session cookie to the backend `/community/feed`; returns null when signed
 * out (401) or unreachable. Mirrors apps/backend/src/community/feed.ts. Always
 * fetched no-store — never the anonymous edge cache the public pages use.
 */
const backendUrl = process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:4000';

export interface FeedGame {
  slug: string;
  name: string;
  coverUrl: string | null;
}
export interface FeedTopic {
  slug: string;
  title: string;
  lastActivityAt: string | null;
}
export interface FeedItem {
  id: string;
  title: string;
  url: string | null;
  excerpt: string | null;
  origin: string;
  publishDate: string | null;
  sourceName: string | null;
  sourceSlug: string | null;
  via: { type: 'game' | 'topic'; name: string; slug: string };
}
export interface FeedData {
  followedGames: FeedGame[];
  followedTopics: FeedTopic[];
  items: FeedItem[];
  isEmpty: boolean;
}

export interface MyExport {
  data: {
    ratings: { game: string; gameName: string; score: number; ratedAt: string }[];
    comments: { entityType: string; body: string; createdAt: string; isRemoved: boolean }[];
    follows: { entityType: string; entityId: string; createdAt: string }[];
  };
}

/** Fetch the signed-in user's GDPR export server-side (for the account panel). */
export async function getMyExport(): Promise<MyExport['data'] | null> {
  try {
    const cookieHeader = (await cookies()).toString();
    if (!cookieHeader) return null;
    const res = await fetch(`${backendUrl}/auth/export`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as MyExport;
    return body.data ?? null;
  } catch {
    return null;
  }
}

export async function getFeed(): Promise<FeedData | null> {
  try {
    const cookieHeader = (await cookies()).toString();
    if (!cookieHeader) return null;
    const res = await fetch(`${backendUrl}/community/feed`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: FeedData };
    return body.data ?? null;
  } catch {
    return null;
  }
}
