import type { Metadata } from 'next';
import { SearchManager } from '../_components/SearchManager';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Search · Control Panel',
  robots: { index: false },
};

export default function SearchAdminPage(): React.JSX.Element {
  return <SearchManager />;
}
