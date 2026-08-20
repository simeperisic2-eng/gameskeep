import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Baseline security headers. The Content-Security-Policy is NO LONGER set here —
 * it moved to `proxy.ts` (I8 phase-close) so it can carry a per-request
 * nonce and drop `script-src 'unsafe-inline'` (a strict, injected-inline-script-
 * blocking CSP). These remaining headers are request-independent, so they stay
 * static config.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output → a lean, self-contained runtime image for Docker.
  output: 'standalone',
  // We live in a monorepo; trace files from the repo root so standalone works.
  outputFileTracingRoot: path.join(dirname, '../../'),
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
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
