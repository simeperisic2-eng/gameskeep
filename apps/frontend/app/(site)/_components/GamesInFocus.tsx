import { bandLabel, label } from '@/lib/labels';
import type {
  CardTag,
  HomepageSectionItem,
  PaidInfo,
  PublicDisplay,
  RankedGame,
} from '@/lib/public-api';
import { PaidLabel } from './PaidLabel';
import { TagChips } from './TagChips';
import { HomeGameCard } from './HomeGameCard';
import { TopicCard } from './TopicCard';
import { scoreToTen } from '@/lib/format';

/**
 * Games in focus (BLUEPRINT 3.1) — recently rated + the controversial ones with
 * a big critic↔community gap. This is where the DISCONNECT differentiator
 * surfaces on the homepage, bridging the news side to the catalog.
 */
function Disconnect({ value, band }: { value: number; band: string | null }): React.JSX.Element {
  const key = band ?? 'mild';
  return (
    <span className={`gk-disconnect gk-disc-${key}`}>
      <span className="num">{(value / 10).toFixed(1)}</span>
      {bandLabel(key) ?? 'Gap'}
    </span>
  );
}

function ScoreCol({
  label,
  score,
  amber = false,
}: {
  label: string;
  score: number | null;
  amber?: boolean;
}): React.JSX.Element | null {
  const display = scoreToTen(score);
  if (!display) return null;
  return (
    <div className="gk-scorecol">
      <span className="label">{label}</span>
      <span className={`val${amber ? ' amber' : ''}`}>{display}</span>
    </div>
  );
}

/**
 * An organic focus game, a paid GAME (owner decision B — same score card, with
 * its render-forced label), or a paid STORY (a story card with its label).
 */
export type FocusEntry =
  | { game: RankedGame; paid?: PaidInfo | null; tags?: CardTag[] }
  | { paidItem: HomepageSectionItem };

export function GamesInFocus({
  entries,
  display,
  title = 'Games in focus',
}: {
  entries: FocusEntry[];
  display: PublicDisplay;
  title?: string;
}): React.JSX.Element | null {
  if (entries.length === 0) return null;
  return (
    <section className="gk-container gk-section" aria-label="Games in focus">
      <div className="gk-section-head">
        <div>
          <span className="gk-eyebrow">{label('home.focus.eyebrow')}</span>
          <h2 className="gk-section-title">{title}</h2>
          <p className="gk-section-sub">{label('home.focus.sub')}</p>
        </div>
        <a className="gk-readlink" href="/games">
          All ratings →
        </a>
      </div>

      <div className="gk-focus-grid">
        {entries.map((e, i) =>
          'paidItem' in e ? (
            e.paidItem.topic ? (
              <TopicCard
                key={`paid:${i}`}
                topic={e.paidItem.topic}
                display={display}
                layout="stacked"
                paid={e.paidItem.paid}
                tags={e.paidItem.tags}
              />
            ) : (
              <HomeGameCard key={`paid:${i}`} item={e.paidItem} />
            )
          ) : (
            <a
              key={`${e.paid ? 'paid' : 'org'}:${e.game.slug}:${i}`}
              className={`gk-gamecard${e.paid ? ' is-paid' : ''}`}
              href={`/games/${e.game.slug}`}
            >
              {e.paid ? <PaidLabel paid={e.paid} /> : null}
              <h3 className="gk-gamecard-name">{e.game.name}</h3>
              <div className="gk-scores">
                <ScoreCol label="Critics" score={e.game.critics} />
                <ScoreCol label="Community" score={e.game.community} />
                <ScoreCol label="Our" score={e.game.our} amber />
              </div>
              {e.game.disconnectValue != null ? (
                <Disconnect value={e.game.disconnectValue} band={e.game.disconnectBand} />
              ) : null}
              {/* the whole card is one link → tags as text, never nested anchors */}
              <TagChips tags={e.tags ?? []} asLinks={false} />
            </a>
          ),
        )}
      </div>
    </section>
  );
}
