import type { Metadata } from 'next';
import { DocPage } from '../_components/DocPage';
import { UnsubscribeConfirm } from '../_components/UnsubscribeConfirm';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  title: 'Unsubscribe',
  description: 'Unsubscribe from GamesKeep email updates.',
  alternates: { canonical: `${siteUrl}/unsubscribe` },
  robots: { index: false, follow: false },
};

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}): Promise<React.JSX.Element> {
  const { token } = await searchParams;
  return (
    <DocPage
      eyebrow="Email preferences"
      title="Unsubscribe"
      lede="Manage the GamesKeep emails sent to your address."
      crumbLabel="Unsubscribe"
      crumbPath="/unsubscribe"
    >
      <UnsubscribeConfirm token={token ?? ''} />
    </DocPage>
  );
}
