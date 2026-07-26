import type { TopicTimelineEntry } from '@/lib/public-api';

/**
 * Developing-story timeline (BLUEPRINT 2.1) — the chronological spine of how a
 * story unfolded, newest at the top. Each entry is a real clustered event
 * (an article joining the story), so the timeline is built from stored data, not
 * invented. Shown only for Developing topics that actually have events.
 */
function dateLabel(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function StoryTimeline({
  entries,
}: {
  entries: TopicTimelineEntry[];
}): React.JSX.Element | null {
  if (entries.length === 0) return null;
  const ordered = [...entries].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
  return (
    <section className="gk-panel gk-timeline-panel" aria-label="Story timeline">
      <div className="gk-panel-head">
        <h2 className="gk-panel-title">How it developed</h2>
        <span className="gk-live">
          <span className="gk-pulse" aria-hidden />
          Developing
        </span>
      </div>
      <ol className="gk-timeline">
        {ordered.map((e, i) => (
          <li key={`${e.occurredAt}-${i}`} className="gk-timeline-item">
            <span className="gk-timeline-dot" aria-hidden />
            <time className="gk-timeline-date" dateTime={e.occurredAt}>
              {dateLabel(e.occurredAt)}
            </time>
            <span className="gk-timeline-label">{e.label}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
