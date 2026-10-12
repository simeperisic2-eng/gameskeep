import type { Metadata } from 'next';
import { getTagQueue, getTagSettings } from '../lib';
import { TagsManager } from '../_components/TagsManager';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Tags · Control Panel',
  robots: { index: false },
};

export default async function TagsPage(): Promise<React.JSX.Element> {
  const [queue, settings] = await Promise.all([getTagQueue(), getTagSettings()]);
  return <TagsManager initial={queue} settings={settings} />;
}
