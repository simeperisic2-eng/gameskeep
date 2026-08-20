import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Space_Grotesk, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

/**
 * Render every route dynamically (I8 phase-close). The strict nonce-CSP in
 * `proxy.ts` stamps a PER-REQUEST nonce onto Next's hydration scripts; a
 * statically-prerendered page bakes its scripts at build time with no nonce, so
 * under `script-src 'strict-dynamic'` those scripts would be refused and the
 * page wouldn't hydrate (breaking the auth/promote forms). Forcing dynamic
 * rendering makes the nonce apply everywhere. Cost is the ~13 previously-static
 * doc/auth pages — accepted (they're light, still SSR, still crawlable); the
 * content pages were already dynamic. Data is still cache-everything at the API
 * layer, so this does not add heavy per-request work.
 */
export const dynamic = 'force-dynamic';

/**
 * Brand type (SPEC I5a). next/font self-hosts these at build time — the fonts
 * are bundled and served from our origin, so there is NO runtime network to
 * Google (honors the offline-demo rule). Space Grotesk = display/headings (a
 * precise, slightly technical character); IBM Plex Sans = body/data; IBM Plex
 * Mono = the rating/score numbers — the "data instrument" feel.
 */
const fontDisplay = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--gk-font-display',
  display: 'swap',
});
const fontBody = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--gk-font-body',
  display: 'swap',
});
const fontMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--gk-font-mono',
  display: 'swap',
});

// Site-wide SEO defaults (SPEC I5a). Real public content is now indexable; the
// admin console and the foundation status page override this to noindex in
// their own metadata. Individual pages set their own title/canonical/OG.
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'GamesKeep — Gaming News with a Bias Lens & Honest Game Ratings',
    template: '%s · GamesKeep',
  },
  description:
    'GamesKeep — premium gaming platform: news + bias analysis and ratings/rankings for video games.',
  applicationName: 'GamesKeep',
  openGraph: {
    type: 'website',
    siteName: 'GamesKeep',
    url: siteUrl,
    title: 'GamesKeep',
    description: 'Premium gaming platform: news + bias analysis and ratings/rankings.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GamesKeep',
    description: 'Premium gaming platform: news + bias analysis and ratings/rankings.',
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
