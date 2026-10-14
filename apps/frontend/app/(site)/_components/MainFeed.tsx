'use client';

import { useState } from 'react';
import type { HomepageSectionItem, PublicDisplay } from '@/lib/public-api';
import { TopicCard } from './TopicCard';
import { HomeGameCard } from './HomeGameCard';
import { useSite } from './SiteProvider';

/**
 * Main feed (BLUEPRINT 3.1) — newest/active topics as cards with a "load more".
 * ALL cards are rendered into the DOM at SSR (extra ones CSS-hidden until
 * revealed) so the feed is fully crawlable — load-more reveals SEO content, it
 * doesn't fetch it. It NEVER auto-scrolls. Paid inserts (owner decision B) render
 * in place with their forced label; the organic cards are exactly the feed's.
 */
export function MainFeed({
  items,
  display,
}: {
  items: HomepageSectionItem[];
  display: PublicDisplay;
}): React.JSX.Element {
  // Phase P S3b: the initial count is a rule (Rules & limits → latest initial).
  const { layout, t } = useSite();
  const [shown, setShown] = useState(Math.max(1, layout.latestInitial));
  const entries = items.filter((i) => i.topic || i.game);

  if (entries.length === 0) {
    return <p className="gk-section-sub">{t('empty.mainFeed')}</p>;
  }

  return (
    <div className="gk-feed">
      {entries.map((it, i) => (
        <div
          key={`${it.paid ? 'paid' : 'org'}:${it.topic?.id ?? it.game?.slug}:${i}`}
          style={i < shown ? undefined : { display: 'none' }}
        >
          {it.topic ? (
            <TopicCard topic={it.topic} display={display} paid={it.paid} tags={it.tags} />
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
