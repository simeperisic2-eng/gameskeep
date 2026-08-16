'use client';

/**
 * Client-side API helper (SPEC I6, Slice 8). All mutations go through the
 * same-origin BFF (/api/auth/*, /api/community/*) and double-submit a CSRF
 * token fetched from /api/auth/csrf. The session cookie rides along
 * automatically (same-origin). Never talks to the backend directly.
 */
let csrfToken: string | null = null;

async function csrf(): Promise<string | undefined> {
  if (csrfToken) return csrfToken;
  try {
    const r = await fetch('/api/auth/csrf', { cache: 'no-store' });
    const b = (await r.json()) as { token?: string };
    csrfToken = b.token ?? null;
    return csrfToken ?? undefined;
  } catch {
    return undefined;
  }
}

export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  message?: string;
  body?: unknown;
}

async function send<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') {
    const token = await csrf();
    if (token) headers['x-csrf-token'] = token;
  }
  try {
    const r = await fetch(path, {
      method,
      headers,
      cache: 'no-store',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let parsed: Record<string, unknown> = {};
    try {
      parsed = (await r.json()) as Record<string, unknown>;
    } catch {
      /* empty/non-JSON */
    }
    return {
      ok: r.ok,
      status: r.status,
      data: parsed.data as T | undefined,
      error: parsed.error as string | undefined,
      message: parsed.message as string | undefined,
      body: parsed,
    };
  } catch {
    return { ok: false, status: 0, error: 'network', message: 'Network error — please retry.' };
  }
}

export const apiGet = <T>(path: string) => send<T>('GET', path);
export const apiPost = <T>(path: string, body?: unknown) => send<T>('POST', path, body);
export const apiDelete = <T>(path: string, body?: unknown) => send<T>('DELETE', path, body);

/** Drop the cached CSRF token (after logout / login, the cookie rotates). */
export function resetCsrf(): void {
  csrfToken = null;
}

// ── the signed-in user (client mirror of /auth/me) ───────────────────────────
export interface MeUser {
  id: string;
  username: string;
  displayName: string | null;
  isEmailVerified: boolean;
  role: { key: string; label: string; isStaff: boolean };
  level: { key: string; label: string; progress: number } | null;
  badges: { key: string; label: string; iconUrl: string | null }[];
}

export async function fetchMe(): Promise<MeUser | null> {
  const r = await apiGet<never>('/api/auth/me');
  if (!r.ok) return null;
  return (r.body as { user?: MeUser })?.user ?? null;
}
