import type { Metadata } from 'next';
import { getNewsOverview } from '../lib';
import { NewsCategoriesManager } from '../_components/NewsCategoriesManager';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'News categories · Control Panel',
  robots: { index: false },
};

export default async function NewsCategoriesPage(): Promise<React.JSX.Element> {
  return <NewsCategoriesManager initial={await getNewsOverview()} />;
}
