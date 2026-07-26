'use client';

import { useState } from 'react';
import type { TopicCard as TopicCardData } from '@/lib/public-api';
import { TopicCard } from './TopicCard';

/**
 * Main feed (BLUEPRINT 3.1) — newest/active topics as cards with a "load more".
 * ALL cards are rendered into the DOM at SSR (extra ones CSS-hidden until
 * revealed) so the feed is fully crawlable — load-more reveals SEO content, it
 * doesn't fetch it. It NEVER auto-scrolls.
 */
const INITIAL = 9;

export function MainFeed({ topics }: { topics: TopicCardData[] }): React.JSX.Element {
  const [shown, setShown] = useState(INITIAL);

  if (topics.length === 0) {
    return <p className="gk-section-sub">Stories are being clustered — check back shortly.</p>;
  }

  return (
    <div className="gk-feed">
      {topics.map((t, i) => (
        <div key={t.id} style={i < shown ? undefined : { display: 'none' }}>
          <TopicCard topic={t} />
        </div>
      ))}
      {shown < topics.length && (
        <button type="button" className="gk-loadmore" onClick={() => setShown(topics.length)}>
          Load more stories ({topics.length - shown})
        </button>
      )}
    </div>
  );
}
