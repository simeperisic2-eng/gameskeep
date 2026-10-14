import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './site.css';
import { SiteHeader } from './_components/SiteHeader';
import { SiteFooter } from './_components/SiteFooter';
import { SiteProvider } from './_components/SiteProvider';
import { getSite, toClientSite } from '@/lib/site';

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

export default async function SiteLayout({
  children,
}: {
  children: ReactNode;
}): Promise<React.JSX.Element> {
  // Phase P S3b: one copy-registry read per request, shared with every page.
  const site = await getSite();
  return (
    <SiteProvider value={toClientSite(site)}>
      <div className="gk-site">
        <SiteHeader site={site} />
        {children}
        <SiteFooter site={site} />
      </div>
    </SiteProvider>
  );
}
