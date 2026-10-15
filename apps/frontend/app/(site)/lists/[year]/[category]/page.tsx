import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { getListConsensus } from '@/lib/public-api';
import { getSite, siteText } from '@/lib/site';
import { JsonLd } from '@/lib/jsonld';
import { breadcrumbLd } from '@/lib/schema';
import { Breadcrumbs } from '../../../_components/Breadcrumbs';

/**
 * One editorial-list consensus (Phase P S4): games ranked by how many confirmed
 * lists include them, then by average position. Owner rule: an outlet's list is
 * never republished as a page of ours — this shows the consensus, each game's
 * positions ("#3 at IGN", linking to that list), data-only comparison lines,
 * and the source lists as links out. No list's entries are listed.
 */
export const dynamic = 'force-dynamic';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
type Params = Promise<{ year: string; category: string }>;

const load = cache(async (yearRaw: string, category: string) => {
  const year = Number.parseInt(yearRaw, 10);
  if (!Number.isInteger(year) || !/^[a-z0-9][a-z0-9-]{0,38}$/.test(category)) return null;
  return getListConsensus(year, category);
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { year, category } = await params;
  const [site, view] = await Promise.all([getSite(), load(year, category)]);
  if (!view) return { title: 'List not found', robots: { index: false } };
  const url = `${siteUrl}/lists/${view.year}/${view.category.key}`;
  const title = `${view.category.label} ${view.year} — the consensus of ${view.totalLists} lists`;
  const description = siteText(site, 'lists.metaDescription');
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', url, title, description },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function ListConsensusPage({
  params,
}: {
  params: Params;
}): Promise<React.JSX.Element> {
  const { year, category } = await params;
  const [site, view] = await Promise.all([getSite(), load(year, category)]);
  if (!view) notFound();
  const pageUrl = `${siteUrl}/lists/${view.year}/${view.category.key}`;
  const crumbs = [
    { name: 'Home', url: `${siteUrl}/` },
    { name: 'Lists', url: `${siteUrl}/lists` },
    { name: `${view.category.label} ${view.year}`, url: pageUrl },
  ];
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${view.category.label} ${view.year} — consensus`,
    url: pageUrl,
    numberOfItems: view.rows.length,
    itemListElement: view.rows.map((r) => ({
      '@type': 'ListItem',
      position: r.position,
      name: r.game.name,
      url: `${siteUrl}/games/${r.game.slug}`,
    })),
  };

  return (
    <>
      <JsonLd data={[breadcrumbLd(crumbs), itemList]} />
      <div className="gk-container gk-catalog gk-lists">
        <Breadcrumbs
          items={crumbs.map((c) => ({ name: c.name, url: c.url.replace(siteUrl, '') || '/' }))}
        />
        <header className="gk-catalog-head">
          <div>
            <span className="gk-eyebrow">{siteText(site, 'lists.eyebrow')}</span>
            <h1 className="gk-catalog-title">
              {view.category.label} {view.year}
            </h1>
            <p className="gk-section-sub">{siteText(site, 'lists.consensusIntro')}</p>
          </div>
          <span className="gk-catalog-count">
            <b>{view.totalLists}</b> lists
          </span>
        </header>

        {view.rows.length === 0 ? (
          <p className="gk-section-sub">No game appears on enough of these lists yet.</p>
        ) : (
          <ol className="gk-consensus">
            {view.rows.map((r) => (
              <li key={r.game.slug} className="gk-consensus-row">
                <span className="gk-consensus-pos">{r.position}</span>
                <div className="gk-consensus-body">
                  <a className="gk-consensus-game" href={`/games/${r.game.slug}`}>
                    {r.game.name}
                  </a>
                  <span className="gk-consensus-stats">
                    Average position #{r.avgRank.toFixed(1)}
                  </span>
                  <span className="gk-consensus-positions">
                    {r.positions.map((p) =>
                      p.url ? (
                        <a
                          key={`${p.outlet}:${p.rank}`}
                          className="gk-chip gk-chip-link"
                          href={p.url}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                        >
                          #{p.rank} at {p.outlet}
                        </a>
                      ) : (
                        <span key={`${p.outlet}:${p.rank}`} className="gk-chip">
                          #{p.rank} at {p.outlet}
                        </span>
                      ),
                    )}
                  </span>
                  {r.lines.length ? (
                    <ul className="gk-consensus-lines">
                      {r.lines.map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}

        <section className="gk-consensus-sources" aria-label="The lists">
          <h2 className="gk-section-title">The lists</h2>
          <p className="gk-section-sub">Each list is the outlet’s own — read it at the source.</p>
          <ul>
            {view.lists.map((l) => (
              <li key={`${l.outlet}:${l.url}`}>
                <a href={l.url} target="_blank" rel="noopener noreferrer nofollow">
                  {l.outlet} — {l.title} <span aria-hidden>↗</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
