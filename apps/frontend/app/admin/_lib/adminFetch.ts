'use client';

/**
 * Client-side admin fetch (SPEC I8, Slice 1). The Control Panel now authenticates
 * the STAFF via their session cookie (not the retired blanket admin-token proxy),
 * so mutations must double-submit the CSRF token the backend requires on the
 * cookie path. This wraps `fetch`, attaching `x-csrf-token` on any non-GET, and
 * returns the raw `Response` so existing call sites keep using `res.ok` /
 * `res.json()` unchanged. The session cookie rides along automatically
 * (same-origin) and the BFF relays it to the backend, which applies RBAC.
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

export async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (method !== 'GET' && method !== 'HEAD') {
    const token = await csrf();
    if (token) headers.set('x-csrf-token', token);
  }
  return fetch(path, { ...init, headers, cache: 'no-store' });
}
