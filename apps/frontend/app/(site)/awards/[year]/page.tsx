import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getAwardsEdition } from '@/lib/public-api';
import { JsonLd } from '@/lib/jsonld';
import { breadcrumbLd } from '@/lib/schema';
import { Breadcrumbs } from '../../_components/Breadcrumbs';
import { AwardCategoryResults } from '../../_components/AwardCategoryResults';
import { AdSlot } from '../../_components/AdSlot';

export const dynamic = 'force-dynamic';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

const parseYear = (raw: string): number | null => {
  const y = Number.parseInt(raw, 10);
  return Number.isInteger(y) && y >= 1970 && y <= 2200 ? y : null;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ year: string }>;
}): Promise<Metadata> {
  const { year: raw } = await params;
  const year = parseYear(raw);
  if (year == null) return { title: 'Awards' };
  const view = await getAwardsEdition(year);
  const name = view?.edition.name ?? `GamesKeep Awards ${year}`;
  return {
    title: `${name} — Winners`,
    description: `Winners of the ${name}: Critics’ Choice and Community Choice in every category, with the analytics behind each pick.`,
    alternates: { canonical: `${siteUrl}/awards/${year}` },
    openGraph: { type: 'website', url: `${siteUrl}/awards/${year}`, title: `${name} — Winners` },
    twitter: { card: 'summary_large_image', title: `${name} — Winners` },
  };
}

export default async function AwardsYearPage({
  params,
}: {
  params: Promise<{ year: string }>;
}): Promise<React.JSX.Element> {
  const { year: raw } = await params;
  const year = parseYear(raw);
  if (year == null) notFound();
  const view = await getAwardsEdition(year);
  // Only decided, published editions are public here — an unpublished draft 404s.
  if (!view || view.edition.comingSoon || view.categories.length === 0) notFound();

  const crumbs = [
    { name: 'Home', url: `${siteUrl}/` },
    { name: 'Awards', url: `${siteUrl}/awards` },
    { name: String(year), url: `${siteUrl}/awards/${year}` },
  ];
  const jsonLd = [breadcrumbLd(crumbs)];

  return (
    <>
      <JsonLd data={jsonLd} />

      <div className="gk-container gk-aw">
        <Breadcrumbs
          items={crumbs.map((c) => ({ name: c.name, url: c.url.replace(siteUrl, '') || '/' }))}
        />

        <header className="gk-aw-hero">
          <span className="gk-eyebrow">GamesKeep Awards · Winners</span>
          <h1 className="gk-aw-title">{view.edition.name}</h1>
          <p className="gk-aw-lede">
            Critics’ Choice and Community Choice in every category — shown separately, with the
            analytics behind each pick.
          </p>
        </header>

        <section className="gk-aw-cats">
          {view.categories.map((cat) => (
            <AwardCategoryResults key={cat.editionCategoryId} category={cat} />
          ))}
        </section>

        <p className="gk-aw-backlink">
          <a href="/awards">← Back to the Awards</a>
        </p>

        <div className="gk-aw-foot">
          <AdSlot />
        </div>
      </div>
    </>
  );
}
