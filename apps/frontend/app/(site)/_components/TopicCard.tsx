import type { TopicCard as TopicCardData } from '@/lib/public-api';
import { relativeTime } from '@/lib/format';
import { CoverArt } from './CoverArt';
import { BiasMini } from './BiasBar';

/**
 * Main-feed topic card (BLUEPRINT 3.1) in the Ground-News mid-card layout:
 * content on the left, and — ONLY where the story maps to a game — a small
 * licensed cover on the right (the `imageUrl` slot; a designed placeholder in
 * demo). Stories not tied to a game stay clean and typographic. The mini bias
 * bar keeps the news+bias pairing on every card as a secondary signal.
 */
export function TopicCard({ topic }: { topic: TopicCardData }): React.JSX.Element {
  const time = relativeTime(topic.lastActivityAt);
  const hasCover = topic.primaryGame != null;
  return (
    <a className={`gk-topiccard${hasCover ? ' has-cover' : ''}`} href={`/topics/${topic.slug}`}>
      <div className="gk-topiccard-body">
        <div className="gk-chips">
          {topic.typeLabel ? <span className="gk-chip amber">{topic.typeLabel}</span> : null}
          {topic.primaryGame ? <span className="gk-chip">{topic.primaryGame.name}</span> : null}
        </div>
        <h3 className="gk-topiccard-title">{topic.title}</h3>
        {topic.tldr ? <p className="gk-topiccard-tldr">{topic.tldr}</p> : null}
        <BiasMini
          flags={topic.flags}
          distribution={topic.distribution}
          sourceCount={topic.sourceCount}
        />
        <div className="gk-topiccard-foot">
          <span className="gk-meta">
            <span>
              {topic.articleCount} {topic.articleCount === 1 ? 'article' : 'articles'}
            </span>
            {time ? (
              <>
                <span className="dot" aria-hidden>
                  ·
                </span>
                <span>{time}</span>
              </>
            ) : null}
          </span>
        </div>
      </div>
      {hasCover ? (
        <div className="gk-topiccard-cover">
          <CoverArt label={topic.primaryGame!.name} variant="thumb" />
        </div>
      ) : null}
    </a>
  );
}
