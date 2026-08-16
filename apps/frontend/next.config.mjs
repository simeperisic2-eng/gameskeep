import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Content-Security-Policy (I6 security review #5 — this was deferred since I5;
 * the public UI has shipped, so it lands now). Defence-in-depth on top of the
 * shared JSON-LD escaper (review #2): `object-src 'none'` blocks plugin/embed
 * XSS, `base-uri`/`form-action 'self'` block base-tag hijack + form-exfil
 * phishing, `frame-ancestors 'self'` complements X-Frame-Options, and
 * `connect-src 'self'` limits exfiltration to same-origin.
 *
 * NOTE: `script-src`/`style-src` keep `'unsafe-inline'` because Next's
 * production hydration emits inline <script>/<style> with no nonce. A strict
 * nonce-based CSP (which would also block injected inline scripts) needs a
 * request-nonce middleware and is tracked for I8. `'unsafe-eval'` is NOT
 * granted (production Next does not require it).
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output → a lean, self-contained runtime image for Docker.
  output: 'standalone',
  // We live in a monorepo; trace files from the repo root so standalone works.
  outputFileTracingRoot: path.join(dirname, '../../'),
  reactStrictMode: true,
  poweredByHeader: false,
  // Baseline security headers + the Content-Security-Policy (see `csp` above).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
