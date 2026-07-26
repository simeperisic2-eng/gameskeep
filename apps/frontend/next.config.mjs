import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output → a lean, self-contained runtime image for Docker.
  output: 'standalone',
  // We live in a monorepo; trace files from the repo root so standalone works.
  outputFileTracingRoot: path.join(dirname, '../../'),
  reactStrictMode: true,
  poweredByHeader: false,
  // Baseline security headers (full CSP tuning lands with the public UI in I5).
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
