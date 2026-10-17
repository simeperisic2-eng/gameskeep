import type { Metadata } from 'next';
import { getStorySummaries } from '../lib';
import { StorySummariesManager } from '../_components/StorySummariesManager';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Story AI text · Control Panel',
  robots: { index: false },
};

export default async function StorySummariesPage(): Promise<React.JSX.Element> {
  return <StorySummariesManager initial={await getStorySummaries('ai')} />;
}
