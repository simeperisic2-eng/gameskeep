import type { Metadata } from 'next';
import { getSources } from '@/lib/public-api';
import { JsonLd } from '@/lib/jsonld';
import { breadcrumbLd } from '@/lib/schema';
import { Breadcrumbs } from '../_components/Breadcrumbs';
import { SourceCardItem } from '../_components/SourceCardItem';
import { AdSlot } from '../_components/AdSlot';

export const dynamic = 'force-dynamic';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  title: 'Sources',
  description:
    'Every outlet GamesKeep aggregates — who owns them, where ownership is shared, their reputation, and the bias signals in their coverage. Transparency on who is telling the story.',
  alternates: { canonical: `${siteUrl}/sources` },
  openGraph: {
    type: 'website',
    url: `${siteUrl}/sources`,
    title: 'Sources — who covers games, and who owns them',
    description:
      'Ownership, shared-ownership conflicts, reputation and coverage stats for every outlet we aggregate.',
  },
  twitter: { card: 'summary_large_image', title: 'Sources' },
};

export default async function SourcesPage(): Promise<React.JSX.Element> {
  const { sources, owners, articleTotal } = await getSources();

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
            <span className="gk-eyebrow">Who&apos;s covering games</span>
            <h1 className="gk-catalog-title">Sources</h1>
            <p className="gk-section-sub">
              Who tells the story matters as much as the story. Every outlet we aggregate — its
              ownership, where that ownership is shared, its reputation, and the bias signals in its
              coverage.
            </p>
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
              <p className="gk-owners-sub">
                Several outlets we index share a parent company — worth knowing when their coverage
                lines up.
              </p>
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
              <SourceCardItem key={s.slug} source={s} />
            ))}
          </div>
        ) : (
          <div className="gk-catalog-empty">
            <p className="gk-section-sub" style={{ margin: 0 }}>
              No sources are configured yet — outlets appear here as the feed is set up.
            </p>
          </div>
        )}

        <div className="gk-catalog-foot">
          <AdSlot />
        </div>
      </div>
    </>
  );
}
