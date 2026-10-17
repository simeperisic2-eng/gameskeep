import { AI_SUMMARY_LABEL, steamAiSummaryLabel } from '@gameskeep/shared/constants';

/**
 * The AI-transparency label (Phase P S5 — EU AI Act transparency rules apply from
 * August 2026). LOCKED like the paid label: the wording is a code constant, not
 * copy or a setting, and no prop can hide it. Render it wherever automatically
 * published AI text shows (story TL;DR / summary, the Steam reviews summary).
 * Text an editor edited or approved is editorial content and does not use it.
 */
export function AiLabel({
  steam,
  compact = false,
}: {
  steam?: { reviews: number; days: number };
  compact?: boolean;
}): React.JSX.Element {
  const text = steam ? steamAiSummaryLabel(steam.reviews, steam.days) : AI_SUMMARY_LABEL;
  return (
    <span className={`gk-ai-label${compact ? ' is-compact' : ''}`} data-ai-label="">
      <span className="gk-chip-dot" aria-hidden />
      {text}
    </span>
  );
}
