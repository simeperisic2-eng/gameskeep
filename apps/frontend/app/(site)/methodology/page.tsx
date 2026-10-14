import type { Metadata } from 'next';
import { getSite, siteDoc, siteText } from '@/lib/site';
import { DocPage } from '../_components/DocPage';
import { DocBody } from '../_components/DocBody';
import { getDisplay } from '@/lib/public-api';
import { brand } from '@/lib/labels';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

// [[OWNER-TODO: review the Methodology framing before public launch — it must stay
// transparent about the APPROACH without ever publishing exact formulas, weights
// or thresholds (publishing the recipe lets coverage and scores be gamed)]]
/**
 * Methodology (SPEC 3.13) — an editable document in the copy registry (Phase P
 * S3b; Control Panel → Copy → Documents). The text defaults to what this page
 * said before; the brand / contact placeholders fill in from settings.
 */
export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite();
  const shareTitle = siteText(site, 'methodology.shareTitle');
  return {
    title: 'Methodology',
    description: siteText(site, 'methodology.metaDescription'),
    alternates: { canonical: `${siteUrl}/methodology` },
    openGraph: {
      siteName: brand(), // Phase P S3b: a page openGraph replaces the layout one
      type: 'website',
      url: `${siteUrl}/methodology`,
      title: shareTitle,
      description: siteText(site, 'methodology.shareDescription'),
    },
    twitter: { card: 'summary_large_image', title: shareTitle },
  };
}

export default async function MethodologyPage(): Promise<React.JSX.Element> {
  const site = await getSite();
  // What the site currently SHOWS (Phase P S1 admin switches) — the document's
  // `::: when quality` part never describes a display the reader can't see.
  const display = await getDisplay();
  const body = siteDoc(site, 'methodology.body');
  return (
    <DocPage
      eyebrow={siteText(site, 'methodology.eyebrow')}
      title={siteText(site, 'methodology.title')}
      lede={siteText(site, 'methodology.lede')}
      crumbLabel="Methodology"
      crumbPath="/methodology"
    >
      <DocBody blocks={body} ctx={{ conditions: { quality: display.showQuality } }} />
    </DocPage>
  );
}
