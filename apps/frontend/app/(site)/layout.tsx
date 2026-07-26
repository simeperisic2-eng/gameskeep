import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './site.css';
import { SiteHeader } from './_components/SiteHeader';
import { SiteFooter } from './_components/SiteFooter';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

/**
 * Public site shell (SPEC I5a) — the gradient/dither canvas + sticky header +
 * footer that wrap every public page. Admin and the foundation status page use
 * the bare root layout, so the premium chrome is scoped to the public site.
 */
export const metadata: Metadata = {
  // Public content is now indexable (the root layout's foundation noindex is
  // overridden here for the real site).
  robots: { index: true, follow: true },
  alternates: { canonical: siteUrl },
};

export default function SiteLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="gk-site">
      <SiteHeader />
      {children}
      <SiteFooter />
    </div>
  );
}
