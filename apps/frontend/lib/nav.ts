/**
 * Navigation helpers (I6 security review #3 — open-redirect guard).
 */

/**
 * Only follow a SAME-SITE relative `next`. Rejects absolute URLs
 * (`https://evil.com`), protocol-relative (`//evil.com`) and backslash tricks
 * (`/\evil.com`, which some browsers normalize to `//`), so a `?next=` param
 * can never redirect off-site after login. Anything invalid → `/feed`.
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/feed';
  return raw;
}
