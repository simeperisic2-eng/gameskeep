'use client';

import { useState } from 'react';
import type { HomepageSectionItem, PublicDisplay } from '@/lib/public-api';
import { TopicCard } from './TopicCard';
import { HomeGameCard } from './HomeGameCard';

/**
 * Main feed (BLUEPRINT 3.1) — newest/active topics as cards with a "load more".
 * ALL cards are rendered into the DOM at SSR (extra ones CSS-hidden until
 * revealed) so the feed is fully crawlable — load-more reveals SEO content, it
 * doesn't fetch it. It NEVER auto-scrolls. Paid inserts (owner decision B) render
 * in place with their forced label; the organic cards are exactly the feed's.
 */
const INITIAL = 9;

export function MainFeed({
  items,
  display,
}: {
  items: HomepageSectionItem[];
  display: PublicDisplay;
}): React.JSX.Element {
  const [shown, setShown] = useState(INITIAL);
  const entries = items.filter((i) => i.topic || i.game);

  if (entries.length === 0) {
    return <p className="gk-section-sub">Stories are being clustered — check back shortly.</p>;
  }

  return (
    <div className="gk-feed">
      {entries.map((it, i) => (
        <div
          key={`${it.paid ? 'paid' : 'org'}:${it.topic?.id ?? it.game?.slug}:${i}`}
          style={i < shown ? undefined : { display: 'none' }}
        >
          {it.topic ? (
            <TopicCard topic={it.topic} display={display} paid={it.paid} />
          ) : (
            <HomeGameCard item={it} layout="row" />
          )}
        </div>
      ))}
      {shown < entries.length && (
        <button type="button" className="gk-loadmore" onClick={() => setShown(entries.length)}>
          Load more stories ({entries.length - shown})
        </button>
      )}
    </div>
  );
}
