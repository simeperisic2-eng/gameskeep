import type { PaidInfo, PublicDisplay, TopicCard as TopicCardData } from '@/lib/public-api';
import { PaidLabel } from './PaidLabel';
import { TagChips } from './TagChips';
import type { CardTag } from '@/lib/public-api';
import { distinctSubtitle, relativeTime } from '@/lib/format';
import { CoverArt } from './CoverArt';
import { BiasMini } from './BiasBar';

/**
 * Main-feed topic card (BLUEPRINT 3.1) in the Ground-News mid-card layout:
 * content on the left, and — ONLY where the story maps to a game — a small
 * licensed cover on the right (the `imageUrl` slot; a designed placeholder in
 * demo). Stories not tied to a game stay clean and typographic. The mini bias
 * bar keeps the news+bias pairing on every card as a secondary signal.
 *
 * B1 structure: the card is a plain CONTAINER — the title + cover are the item
 * links (topic) and the game chip is a SIBLING link (game page). Never an <a>
 * inside an <a> (invalid HTML, broken clicks); max anchor depth = 1.
 */
export function TopicCard({
  topic,
  display,
  layout = 'row',
  paid = null,
  tags = [],
}: {
  topic: TopicCardData;
  display: PublicDisplay;
  /**
   * 'row' (the single-column feed): cover on the right. 'stacked' (3-across
   * grids, Phase P S2): cover on top, the title gets the full card width —
   * no cramped two-line truncation beside a 172px cover.
   */
  layout?: 'row' | 'stacked';
  /** A PAID insert (owner decision B) — the "Promoted" label is render-forced. */
  paid?: PaidInfo | null;
  /** Phase P S3: the primary game's tags, as the section configures them. */
  tags?: CardTag[];
}): React.JSX.Element {
  const time = relativeTime(topic.lastActivityAt);
  const hasCover = topic.primaryGame != null;
  const subtitle = distinctSubtitle(topic.title, topic.tldr);
  return (
    <article
      className={`gk-topiccard${hasCover ? ' has-cover' : ''}${layout === 'stacked' ? ' is-stacked' : ''}${paid ? ' is-paid' : ''}`}
    >
      <div className="gk-topiccard-body">
        {paid ? <PaidLabel paid={paid} /> : null}
        <div className="gk-chips">
          {topic.typeLabel ? <span className="gk-chip amber">{topic.typeLabel}</span> : null}
          {topic.primaryGame ? (
            <a className="gk-chip gk-chip-link" href={`/games/${topic.primaryGame.slug}`}>
              {topic.primaryGame.name}
            </a>
          ) : null}
        </div>
        <h3 className="gk-topiccard-title">
          <a className="gk-title-link" href={`/topics/${topic.slug}`}>
            {topic.title}
          </a>
        </h3>
        {subtitle ? <p className="gk-topiccard-tldr">{subtitle}</p> : null}
        <BiasMini
          flags={topic.flags}
          integrity={topic.integrityTally}
          sourceCount={topic.sourceCount}
          display={display}
        />
        <TagChips tags={tags} />
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
        <a className="gk-topiccard-cover" href={`/topics/${topic.slug}`} tabIndex={-1} aria-hidden>
          <CoverArt label={topic.primaryGame!.name} variant="thumb" />
        </a>
      ) : null}
    </article>
  );
}
