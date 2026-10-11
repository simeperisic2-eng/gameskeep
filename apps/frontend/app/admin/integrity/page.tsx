import type { Metadata } from 'next';
import { getIntegrityReviews } from '../lib';
import { IntegrityManager } from '../_components/IntegrityManager';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Review integrity · Control Panel',
  robots: { index: false },
};

export default async function IntegrityPage(): Promise<React.JSX.Element> {
  const { reviews, autoPublish } = await getIntegrityReviews();
  return <IntegrityManager initial={reviews} autoPublish={autoPublish} />;
}
