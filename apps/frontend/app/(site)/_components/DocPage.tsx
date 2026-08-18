import type { ReactNode } from 'react';
import { JsonLd } from '@/lib/jsonld';
import { breadcrumbLd } from '@/lib/schema';
import { Breadcrumbs } from './Breadcrumbs';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

/**
 * Shared shell for the static / long-form pages (SPEC 3.13 — About, Methodology,
 * Contact, Privacy, Terms). One place owns the chrome so every doc page gets the
 * SAME breadcrumb trail (visible + BreadcrumbList JSON-LD built from the same
 * items, so they never drift), header rhythm and reading column. Pages supply
 * only their prose. No data is read here — these pages are pure content, so they
 * are statically rendered and leak-proof by construction.
 */
export function DocPage({
  eyebrow,
  title,
  lede,
  crumbLabel,
  crumbPath,
  meta,
  children,
}: {
  eyebrow: string;
  title: string;
  lede: ReactNode;
  /** Breadcrumb label for this page (the last, unlinked crumb). */
  crumbLabel: string;
  /** Site-relative path for this page, e.g. `/about`. */
  crumbPath: string;
  /** Optional small uppercase meta line under the lede (e.g. a draft notice). */
  meta?: string;
  children: ReactNode;
}): React.JSX.Element {
  const crumbs = [
    { name: 'Home', url: `${siteUrl}/` },
    { name: crumbLabel, url: `${siteUrl}${crumbPath}` },
  ];
  const jsonLd = [breadcrumbLd(crumbs)];

  return (
    <>
      <JsonLd data={jsonLd} />

      <div className="gk-container gk-doc">
        <Breadcrumbs
          items={crumbs.map((c) => ({ name: c.name, url: c.url.replace(siteUrl, '') || '/' }))}
        />

        <header className="gk-doc-head">
          <span className="gk-eyebrow">{eyebrow}</span>
          <h1 className="gk-doc-title">{title}</h1>
          <p className="gk-doc-lede">{lede}</p>
          {meta ? <p className="gk-doc-meta">{meta}</p> : null}
        </header>

        <div className="gk-prose">{children}</div>
      </div>
    </>
  );
}
