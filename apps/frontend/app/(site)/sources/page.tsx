import type { Metadata } from 'next';
import { getDisplay, getSources } from '@/lib/public-api';
import { JsonLd } from '@/lib/jsonld';
import { breadcrumbLd } from '@/lib/schema';
import { Breadcrumbs } from '../_components/Breadcrumbs';
import { SourceCardItem } from '../_components/SourceCardItem';
import { AdSlot } from '../_components/AdSlot';
import { getSite, siteText } from '@/lib/site';
import { brand } from '@/lib/labels';

export const dynamic = 'force-dynamic';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite();
  return {
    title: 'Sources',
    description: siteText(site, 'sources.metaDescription'),
    alternates: { canonical: `${siteUrl}/sources` },
    openGraph: {
      siteName: brand(), // Phase P S3b: a page openGraph replaces the layout one
      type: 'website',
      url: `${siteUrl}/sources`,
      title: 'Sources — who covers games, and who owns them',
      description: siteText(site, 'sources.shareDescription'),
    },
    twitter: { card: 'summary_large_image', title: 'Sources' },
  };
}

export default async function SourcesPage(): Promise<React.JSX.Element> {
  const [{ sources, owners, articleTotal }, display, site] = await Promise.all([
    getSources(),
    getDisplay(),
    getSite(),
  ]);

  const crumbs = [
    { name: 'Home', url: `${siteUrl}/` },
    { name: 'Sources', url: `${siteUrl}/sources` },
  ];
  const jsonLd = [breadcrumbLd(crumbs)];

  return (
    <>
      <JsonLd data={jsonLd} />

      <div className="gk-container gk-catalog">
        <Breadcrumbs
          items={crumbs.map((c) => ({ name: c.name, url: c.url.replace(siteUrl, '') || '/' }))}
        />

        <header className="gk-catalog-head">
          <div>
            <span className="gk-eyebrow">{siteText(site, 'sources.eyebrow')}</span>
            <h1 className="gk-catalog-title">Sources</h1>
            <p className="gk-section-sub">{siteText(site, 'sources.intro')}</p>
          </div>
          <span className="gk-catalog-count">
            <b>{sources.length}</b> {sources.length === 1 ? 'outlet' : 'outlets'}
            {articleTotal > 0 ? (
              <span className="gk-catalog-count-of"> · {articleTotal} stories</span>
            ) : null}
          </span>
        </header>

        {/* Ownership concentration — the network-level conflict-of-interest view. */}
        {owners.length > 0 ? (
          <section className="gk-owners" aria-label="Ownership concentration">
            <div className="gk-owners-head">
              <h2 className="gk-owners-title">Ownership concentration</h2>
              <p className="gk-owners-sub">{siteText(site, 'sources.owners.sub')}</p>
            </div>
            <div className="gk-owners-list">
              {owners.map((o) => (
                <div key={o.name} className="gk-owner-chip">
                  <span className="gk-owner-name">{o.name}</span>
                  <span className="gk-owner-count">
                    {o.outlets} {o.outlets === 1 ? 'outlet' : 'outlets'}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {sources.length > 0 ? (
          <div className="gk-srccard-grid">
            {sources.map((s) => (
              <SourceCardItem key={s.slug} source={s} showReputation={display.showQuality} />
            ))}
          </div>
        ) : (
          <div className="gk-catalog-empty">
            <p className="gk-section-sub" style={{ margin: 0 }}>
              {siteText(site, 'empty.sources')}
            </p>
          </div>
        )}

        <div className="gk-catalog-foot">
          <AdSlot slotKey="sources" />
        </div>
      </div>
    </>
  );
}
