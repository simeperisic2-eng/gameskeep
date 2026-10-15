import type { Metadata } from 'next';
import { getListsIndex } from '@/lib/public-api';
import { getSite, siteText } from '@/lib/site';
import { JsonLd } from '@/lib/jsonld';
import { breadcrumbLd } from '@/lib/schema';
import { Breadcrumbs } from '../_components/Breadcrumbs';

/**
 * Editorial lists — the index (Phase P S4). One card per (year, category) whose
 * consensus is public (from the admin-set number of confirmed lists). The
 * outlets' own lists are never republished here: each consensus page links out.
 */
export const dynamic = 'force-dynamic';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export async function generateMetadata(): Promise<Metadata> {
  const [site, index] = await Promise.all([getSite(), getListsIndex()]);
  return {
    title: 'Editorial lists — the consensus',
    description: siteText(site, 'lists.metaDescription'),
    alternates: { canonical: `${siteUrl}/lists` },
    // An empty index is not worth indexing.
    ...(index.length ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function ListsIndexPage(): Promise<React.JSX.Element> {
  const [site, index] = await Promise.all([getSite(), getListsIndex()]);
  const crumbs = [
    { name: 'Home', url: `${siteUrl}/` },
    { name: 'Lists', url: `${siteUrl}/lists` },
  ];
  return (
    <>
      <JsonLd data={[breadcrumbLd(crumbs)]} />
      <div className="gk-container gk-catalog gk-lists">
        <Breadcrumbs
          items={crumbs.map((c) => ({ name: c.name, url: c.url.replace(siteUrl, '') || '/' }))}
        />
        <header className="gk-catalog-head">
          <div>
            <span className="gk-eyebrow">{siteText(site, 'lists.eyebrow')}</span>
            <h1 className="gk-catalog-title">Editorial lists</h1>
            <p className="gk-section-sub">{siteText(site, 'lists.intro')}</p>
          </div>
        </header>
        {index.length === 0 ? (
          <p className="gk-section-sub">{siteText(site, 'empty.lists')}</p>
        ) : (
          <div className="gk-listcards">
            {index.map((e) => (
              <a
                key={`${e.year}:${e.categoryKey}`}
                className="gk-listcard"
                href={`/lists/${e.year}/${e.categoryKey}`}
              >
                <span className="gk-listcard-kicker">
                  {e.year} · {e.lists} lists
                </span>
                <span className="gk-listcard-title">{e.label}</span>
                {e.top.length ? (
                  <span className="gk-listcard-top">
                    {e.top.map((g, i) => (
                      <span key={g.slug}>
                        {i + 1}. {g.name}
                      </span>
                    ))}
                  </span>
                ) : null}
                <span className="gk-listcard-cta">See the consensus →</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
