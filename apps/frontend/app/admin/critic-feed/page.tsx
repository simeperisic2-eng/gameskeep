import type { Metadata } from 'next';
import { getCriticFeedData } from '../lib';
import { CriticFeedManager } from '../_components/CriticFeedManager';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Score this review · Control Panel',
  robots: { index: false },
};

export default async function CriticFeedPage(): Promise<React.JSX.Element> {
  return <CriticFeedManager initial={await getCriticFeedData()} />;
}
