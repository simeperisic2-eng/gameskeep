import { NextResponse, type NextRequest } from 'next/server';

/**
 * Strict, nonce-based Content-Security-Policy (I8 phase-close hardening — the
 * version deferred from I6). Each request gets a fresh nonce; `script-src` drops
 * `'unsafe-inline'` in favour of `'self' 'nonce-<n>' 'strict-dynamic'`, so an
 * INJECTED inline `<script>` (a stored-XSS payload that slipped past escaping)
 * has no nonce and is refused by the browser — turning a future injection from a
 * catastrophe into a non-event. Next reads the nonce from the request CSP header
 * we set here and stamps it onto its own hydration scripts (which `'strict-dynamic'`
 * then trusts to load the app chunks).
 *
 * `style-src` keeps `'unsafe-inline'`: React emits inline `style=""` attributes
 * that a nonce can't cover, and inline styles are not a script-execution vector
 * (accepted residual). `<script type="application/ld+json">` is a data block, not
 * executable JS, so `script-src` does not apply to it.
 *
 * COST (accepted, owner-approved): a per-request nonce forces dynamic rendering,
 * so the ~13 static doc/auth pages become SSR (still fast, still crawlable). The
 * content pages were already dynamic, so nothing there changes.
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "connect-src 'self'",
  ].join('; ');

  // Next reads the nonce from the request CSP header and applies it to its
  // scripts; forward the (possibly modified) request headers through.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    // Run on every page/route EXCEPT static assets, image optimizer, favicon and
    // prefetches — those need no per-request nonce and shouldn't be made dynamic.
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
