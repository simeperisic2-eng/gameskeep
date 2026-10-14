import type { Metadata } from 'next';
import { getSite, siteDoc, siteText } from '@/lib/site';
import { DocPage } from '../_components/DocPage';
import { DocBody, docHasSlot } from '../_components/DocBody';
import { PromoteForm } from '../_components/PromoteForm';
import { brand } from '@/lib/labels';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

/**
 * Promote (SPEC 3.13) — an editable document in the copy registry (Phase P
 * S3b; Control Panel → Copy → Documents). The text defaults to what this page
 * said before; the brand / contact placeholders fill in from settings.
 */
export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite();
  const shareTitle = siteText(site, 'promote.shareTitle');
  return {
    title: 'Promote your game',
    description: siteText(site, 'promote.metaDescription'),
    alternates: { canonical: `${siteUrl}/promote` },
    openGraph: {
      siteName: brand(), // Phase P S3b: a page openGraph replaces the layout one
      type: 'website',
      url: `${siteUrl}/promote`,
      title: shareTitle,
      description: siteText(site, 'promote.shareDescription'),
    },
    twitter: { card: 'summary_large_image', title: shareTitle },
  };
}

export default async function PromotePage(): Promise<React.JSX.Element> {
  const site = await getSite();
  const body = siteDoc(site, 'promote.body');
  return (
    <DocPage
      eyebrow={siteText(site, 'promote.eyebrow')}
      title={siteText(site, 'promote.title')}
      lede={siteText(site, 'promote.lede')}
      crumbLabel="Promote"
      crumbPath="/promote"
    >
      <DocBody blocks={body} ctx={{ slots: { 'promote-form': <PromoteForm /> } }} />
      {docHasSlot(body, 'promote-form') ? null : <PromoteForm />}
    </DocPage>
  );
}
