import type { Metadata } from 'next';
import { getSite, siteDoc, siteText } from '@/lib/site';
import { DocPage } from '../_components/DocPage';
import { DocBody } from '../_components/DocBody';
import { brand } from '@/lib/labels';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

// A real writer-submission form with moderation comes in a later phase, so this
// page is deliberately email-only for now. The address is a setting
// (Control Panel → Copy → Brand & contact).
/**
 * Contact (SPEC 3.13) — an editable document in the copy registry (Phase P
 * S3b; Control Panel → Copy → Documents). The text defaults to what this page
 * said before; the brand / contact placeholders fill in from settings.
 */
export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite();
  const shareTitle = siteText(site, 'contact.shareTitle');
  return {
    title: 'Contact & Join',
    description: siteText(site, 'contact.metaDescription'),
    alternates: { canonical: `${siteUrl}/contact` },
    openGraph: {
      siteName: brand(), // Phase P S3b: a page openGraph replaces the layout one
      type: 'website',
      url: `${siteUrl}/contact`,
      title: shareTitle,
      description: siteText(site, 'contact.shareDescription'),
    },
    twitter: { card: 'summary_large_image', title: shareTitle },
  };
}

export default async function ContactPage(): Promise<React.JSX.Element> {
  const site = await getSite();
  const body = siteDoc(site, 'contact.body');
  return (
    <DocPage
      eyebrow={siteText(site, 'contact.eyebrow')}
      title={siteText(site, 'contact.title')}
      lede={siteText(site, 'contact.lede')}
      crumbLabel="Contact"
      crumbPath="/contact"
    >
      <DocBody blocks={body} />
    </DocPage>
  );
}
