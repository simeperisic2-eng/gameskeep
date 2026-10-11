import type { Metadata } from 'next';
import { getListsConfig, getListsSlots } from '../lib';
import { ListsManager } from '../_components/ListsManager';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Lists & slots · Control Panel',
  robots: { index: false },
};

export default async function ListsPage(): Promise<React.JSX.Element> {
  const [{ config }, slots] = await Promise.all([getListsConfig(), getListsSlots()]);
  return <ListsManager initialConfig={config} slots={slots} />;
}
