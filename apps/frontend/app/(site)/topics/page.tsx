import type { Metadata } from 'next';
import { ComingSoon } from '../_components/ComingSoon';

export const metadata: Metadata = { title: 'Topics', robots: { index: false } };

export default function TopicsIndexPage(): React.JSX.Element {
  return (
    <ComingSoon
      eyebrow="News, clustered"
      title="The topics index is on its way"
      body="Browse every story — clustered from across the industry, each with its influence + quality bias bar. For now, open a story straight from the homepage hero."
    />
  );
}
