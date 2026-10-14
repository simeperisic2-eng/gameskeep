import type { Metadata } from 'next';
import { DocPage } from '../_components/DocPage';
import { UnsubscribeConfirm } from '../_components/UnsubscribeConfirm';
import { getSite } from '@/lib/site';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite();
  return {
    title: 'Unsubscribe',
    description: `Unsubscribe from ${site.brand} email updates.`,
    alternates: { canonical: `${siteUrl}/unsubscribe` },
    robots: { index: false, follow: false },
  };
}

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}): Promise<React.JSX.Element> {
  const [{ token }, site] = await Promise.all([searchParams, getSite()]);
  return (
    <DocPage
      eyebrow="Email preferences"
      title="Unsubscribe"
      lede={`Manage the ${site.brand} emails sent to your address.`}
      crumbLabel="Unsubscribe"
      crumbPath="/unsubscribe"
    >
      <UnsubscribeConfirm token={token ?? ''} />
    </DocPage>
  );
}
