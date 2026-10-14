import type { Briefing } from '@/lib/public-api';

function dayLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : 'Latest';
}

/**
 * "Today's briefing" pulse (Phase P S1) — counts only: sources · topics · reviews
 * in the window. Never a percentage. When nothing arrived in the window the
 * server anchors it to the newest coverage and we label that day instead of
 * claiming "Today".
 */
export function BriefingStrip({ briefing }: { briefing: Briefing }): React.JSX.Element | null {
  // Phase P S3b: an editor's line for today replaces the counts (Rules & limits).
  const override = briefing.overrideText?.trim() || null;
  if (override) {
    return (
      <div className="gk-briefing" aria-label="Today's briefing">
        <span className="gk-briefing-tag">
          <span className="gk-pulse" aria-hidden />
          Today
        </span>
        <div className="gk-briefing-items">
          <span className="gk-briefing-item gk-briefing-override">{override}</span>
        </div>
      </div>
    );
  }
  if (briefing.sources === 0 && briefing.topics === 0 && briefing.reviews === 0) return null;
  const items: { value: string; label: string }[] = [
    { value: String(briefing.sources), label: briefing.sources === 1 ? 'source' : 'sources' },
    { value: String(briefing.topics), label: briefing.topics === 1 ? 'topic' : 'topics' },
    { value: String(briefing.reviews), label: briefing.reviews === 1 ? 'review' : 'reviews' },
  ];
  const tag = briefing.isToday || !briefing.asOf ? 'Today' : dayLabel(briefing.asOf);

  return (
    <div className="gk-briefing" aria-label="Today's briefing">
      <span className="gk-briefing-tag">
        <span className="gk-pulse" aria-hidden />
        {tag}
      </span>
      <div className="gk-briefing-items">
        {items.map((it, i) => (
          <span className="gk-briefing-item" key={it.label}>
            <b>{it.value}</b> {it.label}
            {i < items.length - 1 ? (
              <span className="gk-briefing-sep" aria-hidden>
                ·
              </span>
            ) : null}
          </span>
        ))}
      </div>
    </div>
  );
}
