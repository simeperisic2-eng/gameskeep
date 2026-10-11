import type { Metadata } from 'next';
import { getHomepageConfig, getHomepagePreview } from '../lib';
import { HomepageManager } from '../_components/HomepageManager';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Homepage · Control Panel',
  robots: { index: false },
};

export default async function HomepageAdminPage(): Promise<React.JSX.Element> {
  const [config, preview] = await Promise.all([getHomepageConfig(), getHomepagePreview()]);
  return <HomepageManager initial={config} preview={preview} />;
}
