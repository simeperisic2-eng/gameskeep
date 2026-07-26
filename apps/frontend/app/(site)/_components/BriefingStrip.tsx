import type { Briefing } from '@/lib/public-api';

/**
 * "Today's briefing" pulse (BLUEPRINT-adjacent, Ground-News "Daily Briefing"
 * equivalent) — a one-line summary built entirely from data we already have. It
 * frames the front page with substance and reinforces the bias-lens promise.
 */
export function BriefingStrip({ briefing }: { briefing: Briefing }): React.JSX.Element | null {
  if (briefing.stories === 0) return null;
  const items: { value: string; label: string }[] = [
    { value: String(briefing.stories), label: briefing.stories === 1 ? 'story' : 'stories' },
    { value: String(briefing.articles), label: 'articles' },
  ];
  if (briefing.independentPct != null) {
    items.push({ value: `${briefing.independentPct}%`, label: 'independent coverage' });
  }
  items.push({ value: `${briefing.readMinutes} min`, label: 'read' });

  return (
    <div className="gk-briefing" aria-label="Today's briefing">
      <span className="gk-briefing-tag">
        <span className="gk-pulse" aria-hidden />
        Today
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
