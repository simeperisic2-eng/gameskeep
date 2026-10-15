import type { Metadata } from 'next';
import { getListLexicon, getListsQueueData } from '../lib';
import { EditorialListsManager } from '../_components/EditorialListsManager';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Editorial lists · Control Panel',
  robots: { index: false },
};

export default async function EditorialListsPage(): Promise<React.JSX.Element> {
  const [queue, lexicon] = await Promise.all([getListsQueueData(), getListLexicon()]);
  return <EditorialListsManager initial={queue} lexicon={lexicon} />;
}
