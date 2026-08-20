import type { Metadata } from 'next';
import { getListsConfig, getListsPreview, getListsSlots } from '../lib';
import { ListsManager } from '../_components/ListsManager';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Lists & slots · Control Panel',
  robots: { index: false },
};

export default async function ListsPage(): Promise<React.JSX.Element> {
  const [{ config, promotedGameSlugs }, preview, slots] = await Promise.all([
    getListsConfig(),
    getListsPreview(),
    getListsSlots(),
  ]);
  return (
    <ListsManager
      initialConfig={config}
      promotedGameSlugs={promotedGameSlugs}
      initialPreview={preview}
      slots={slots}
    />
  );
}
