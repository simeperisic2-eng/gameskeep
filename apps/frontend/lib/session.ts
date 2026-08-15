import { cookies } from 'next/headers';

/**
 * Server-side session resolution for SSR (SPEC I6, Slice 6). Reads the signed
 * session cookie from the incoming request and asks the backend `/auth/me` who
 * it is — forwarding the cookie verbatim (the backend unsigns it). Returns null
 * when signed out. NEVER carries the raw reputation number (the backend already
 * strips it — decision 11); only level name + progress + badges.
 *
 * Anything using this is PER-USER, so the page must opt out of the anonymous
 * cache (force-dynamic / no-store).
 */
const backendUrl = process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:4000';

export interface SessionLevel {
  key: string;
  label: string;
  progress: number;
}
export interface SessionBadge {
  key: string;
  label: string;
  iconUrl: string | null;
}
export interface SessionUser {
  id: string;
  username: string;
  displayName: string | null;
  isEmailVerified: boolean;
  role: { key: string; label: string; isStaff: boolean };
  level: SessionLevel | null;
  badges: SessionBadge[];
}

export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const cookieHeader = (await cookies()).toString();
    if (!cookieHeader) return null;
    const res = await fetch(`${backendUrl}/auth/me`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { user?: SessionUser };
    return body.user ?? null;
  } catch {
    return null;
  }
}
