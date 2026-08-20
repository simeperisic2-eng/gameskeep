import type { Metadata } from 'next';
import { getNewsletterOverview, getSubscribers } from '../lib';
import { NewsletterManager } from '../_components/NewsletterManager';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Newsletter · Control Panel',
  robots: { index: false },
};

export default async function NewsletterPage(): Promise<React.JSX.Element> {
  const [overview, subscribers] = await Promise.all([getNewsletterOverview(), getSubscribers()]);
  return <NewsletterManager initialOverview={overview} initialSubscribers={subscribers} />;
}
