import type { Metadata } from 'next';
import { getCopyConfig } from '../lib';
import { CopyManager } from '../_components/CopyManager';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Copy · Control Panel',
  robots: { index: false },
};

export default async function CopyPage(): Promise<React.JSX.Element> {
  return <CopyManager initial={await getCopyConfig()} />;
}
