import type { Metadata } from 'next';
import { getSite, siteDoc, siteText } from '@/lib/site';
import { DocPage } from '../_components/DocPage';
import { DocBody } from '../_components/DocBody';
import { brand } from '@/lib/labels';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

/**
 * About (SPEC 3.13) — an editable document in the copy registry (Phase P
 * S3b; Control Panel → Copy → Documents). The text defaults to what this page
 * said before; the brand / contact placeholders fill in from settings.
 */
export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite();
  const shareTitle = siteText(site, 'about.shareTitle');
  return {
    title: 'About',
    description: siteText(site, 'about.metaDescription'),
    alternates: { canonical: `${siteUrl}/about` },
    openGraph: {
      siteName: brand(), // Phase P S3b: a page openGraph replaces the layout one
      type: 'website',
      url: `${siteUrl}/about`,
      title: shareTitle,
      description: siteText(site, 'about.shareDescription'),
    },
    twitter: { card: 'summary_large_image', title: shareTitle },
  };
}

export default async function AboutPage(): Promise<React.JSX.Element> {
  const site = await getSite();
  const body = siteDoc(site, 'about.body');
  return (
    <DocPage
      eyebrow={siteText(site, 'about.eyebrow')}
      title={siteText(site, 'about.title')}
      lede={siteText(site, 'about.lede')}
      crumbLabel="About"
      crumbPath="/about"
    >
      <DocBody blocks={body} />
    </DocPage>
  );
}
