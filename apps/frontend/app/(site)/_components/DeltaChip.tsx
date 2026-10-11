import type { Delta } from '@/lib/public-api';
import { deltaText, windowLabel } from '@/lib/format';

/**
 * A Δ vs the previous window of equal length, with that window on the chip
 * (Phase P S2). "New" = nothing in the previous window; "—" = not enough history
 * — never 0% or a guess. Neutral styling: green/red stay reserved for bias and
 * the disconnect (brand rule).
 */
export function DeltaChip({
  delta,
  windowHours,
}: {
  delta: Delta | null;
  windowHours: number | null;
}): React.JSX.Element | null {
  const text = deltaText(delta);
  const win = windowLabel(windowHours);
  if (!text || !win) return null;
  const title =
    delta?.kind === 'new'
      ? `New — nothing in the previous ${win}`
      : delta?.kind === 'none'
        ? `Not enough history to compare the last ${win} with the ${win} before`
        : `Change vs the previous ${win}`;
  return (
    <span className={`gk-delta is-${delta?.kind ?? 'none'}`} title={title}>
      <b>{text}</b>
      <span className="gk-delta-win">{win}</span>
    </span>
  );
}
