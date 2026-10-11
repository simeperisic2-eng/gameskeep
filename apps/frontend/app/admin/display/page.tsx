import type { Metadata } from 'next';
import { getDisplayConfig } from '../lib';
import { DisplayManager } from '../_components/DisplayManager';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Display & bias · Control Panel',
  robots: { index: false },
};

export default async function DisplayPage(): Promise<React.JSX.Element> {
  return <DisplayManager initial={await getDisplayConfig()} />;
}
